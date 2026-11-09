using System.Net;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>
/// Catalog browsing and requests via Seerr, for the signed-in user (requests design spec, §4.1). Every action goes
/// through <see cref="ISeerrUserMap"/>, which grants no access while Lumen or requests are switched off.
/// </summary>
[ApiController]
[Route("Lumen/Requests")]
[Authorize]
public sealed class RequestsController : ControllerBase
{
    public const int MaxQueryLength = 100;
    public const int MaxPage = 50;
    public const int MaxSeason = 1000;
    private const string Unavailable = "Seerr is unavailable.";

    private readonly ISeerrUserMap _users;
    private readonly ITmdbImageCache _images;
    private readonly ISeerrClient _seerr;
    private readonly HomeCache _home;
    private readonly IUserManager _userManager;
    private readonly CatalogMapper _mapper;
    private readonly ILogger<RequestsController> _logger;

    public RequestsController(
        ISeerrUserMap users,
        ITmdbImageCache images,
        ISeerrClient seerr,
        HomeCache home,
        IUserManager userManager,
        CatalogMapper mapper,
        ILogger<RequestsController> logger)
    {
        _users = users;
        _images = images;
        _seerr = seerr;
        _home = home;
        _userManager = userManager;
        _mapper = mapper;
        _logger = logger;
    }

    /// <summary>Whether the catalog is available to this user, and what they may request.</summary>
    [HttpGet("Status")]
    public async Task<ActionResult<RequestStatusDto>> GetStatus(CancellationToken cancellationToken)
    {
        if (User.GetJellyfinUserId(_logger) is not { } userId)
        {
            return Unauthorized();
        }

        var access = await _users.GetAccessAsync(userId, cancellationToken).ConfigureAwait(false);
        return new RequestStatusDto(access.Enabled, access.CanRequestMovies, access.CanRequestTv);
    }

    /// <summary>TMDB artwork, proxied and cached by the server.</summary>
    [HttpGet("Image/{size}/{file}")]
    public async Task<IActionResult> GetImage([FromRoute] string size, [FromRoute] string file, CancellationToken cancellationToken)
    {
        if (!TmdbImageCache.IsAllowed(size, file))
        {
            return BadRequest();
        }

        if (User.GetJellyfinUserId(_logger) is not { } userId || !(await _users.GetAccessAsync(userId, cancellationToken).ConfigureAwait(false)).Enabled)
        {
            return NotFound();
        }

        // A trim can delete the file between the lookup and opening it; the second lookup downloads it again.
        for (var attempt = 0; attempt < 2; attempt++)
        {
            CachedImage? image;
            try
            {
                image = await _images.GetAsync(size, file, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception e) when (e is HttpRequestException or OperationCanceledException or IOException or UnauthorizedAccessException)
            {
                return StatusCode(StatusCodes.Status502BadGateway);
            }

            if (image is null)
            {
                return NotFound();
            }

            // Opened here rather than served by path, so a trim after this point can't turn the response into a 500.
            if (TmdbImageCache.TryOpen(image.Path) is { } stream)
            {
                Response.Headers.CacheControl = "private, max-age=604800, immutable";
                return File(stream, image.ContentType);
            }
        }

        return StatusCode(StatusCodes.Status502BadGateway);
    }

    /// <summary>Catalog titles (movies and shows) matching <paramref name="query"/>, with their request state.</summary>
    [HttpGet("Search")]
    public async Task<ActionResult<CatalogSearchDto>> Search([FromQuery] string? query, [FromQuery] int page = 1, CancellationToken cancellationToken = default)
    {
        query = query?.Trim();
        if (string.IsNullOrEmpty(query) || query.Length > MaxQueryLength || page is < 1 or > MaxPage)
        {
            return BadRequest(new ErrorDto("Invalid search."));
        }

        var caller = await GetCallerAsync(cancellationToken).ConfigureAwait(false);
        if (caller.Failure is { } failure)
        {
            return failure;
        }

        try
        {
            var result = await _seerr.SearchAsync(caller.Endpoint!, caller.SeerrUserId, query, page, cancellationToken).ConfigureAwait(false);
            return new CatalogSearchDto(_mapper.ToItems(result.Results, caller.User), Math.Max(1, result.Page), Math.Clamp(result.TotalPages, 0, MaxPage));
        }
        catch (SeerrException e)
        {
            return SeerrUnavailable(e, "search");
        }
    }

    /// <summary>A movie or show's details for the title page, with season states and recommendations.</summary>
    [HttpGet("Title/{mediaType}/{tmdbId}")]
    public async Task<ActionResult<CatalogTitleDto>> GetTitle([FromRoute] string mediaType, [FromRoute] int tmdbId, CancellationToken cancellationToken)
    {
        if (!CatalogMediaType.IsValid(mediaType) || tmdbId <= 0)
        {
            return BadRequest(new ErrorDto("Invalid title."));
        }

        var caller = await GetCallerAsync(cancellationToken).ConfigureAwait(false);
        if (caller.Failure is { } failure)
        {
            return failure;
        }

        var endpoint = caller.Endpoint!;
        var recommendations = GetRecommendationsAsync(endpoint, caller, mediaType, tmdbId, cancellationToken);
        SeerrTitle title;
        try
        {
            title = mediaType == CatalogMediaType.Tv
                ? await _seerr.GetTvAsync(endpoint, caller.SeerrUserId, tmdbId, cancellationToken).ConfigureAwait(false)
                : await _seerr.GetMovieAsync(endpoint, caller.SeerrUserId, tmdbId, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException e) when (e.Status == HttpStatusCode.NotFound)
        {
            await recommendations.ConfigureAwait(false);
            return NotFound(new ErrorDto("Title not found."));
        }
        catch (SeerrException e)
        {
            await recommendations.ConfigureAwait(false);
            return SeerrUnavailable(e, "title details");
        }

        try
        {
            return _mapper.ToTitle(mediaType, title, await recommendations.ConfigureAwait(false), caller.Access!, caller.User);
        }
        catch (SeerrException e)
        {
            return SeerrUnavailable(e, "title details");
        }
    }

    /// <summary>Files a request in Seerr as the signed-in user; Seerr applies their permissions, quota and auto-approval.</summary>
    [HttpPost]
    public async Task<ActionResult<RequestResultDto>> CreateRequest([FromBody] CatalogRequestDto? body, CancellationToken cancellationToken)
    {
        if (body is null || !CatalogMediaType.IsValid(body.MediaType) || body.TmdbId <= 0 || body.Seasons?.Any(n => n is < 1 or > MaxSeason) == true)
        {
            return BadRequest(new ErrorDto("Invalid request."));
        }

        var caller = await GetCallerAsync(cancellationToken).ConfigureAwait(false);
        if (caller.Failure is { } failure)
        {
            return failure;
        }

        var tv = body.MediaType == CatalogMediaType.Tv;
        if (!(tv ? caller.Access!.CanRequestTv : caller.Access!.CanRequestMovies))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new ErrorDto(tv ? "You don't have permission to request shows." : "You don't have permission to request movies."));
        }

        var seasons = tv ? body.Seasons?.Distinct().Order().ToList() : null;
        try
        {
            var result = await _seerr.CreateRequestAsync(caller.Endpoint!, caller.SeerrUserId, body.MediaType!, body.TmdbId, seasons, cancellationToken).ConfigureAwait(false);

            // The cached home (My Requests, catalog rows) still shows the title as requestable.
            _home.InvalidateUser(caller.UserId);
            var state = result.MediaStatus is { } status ? CatalogMapper.MapStatus(status) : CatalogState.Requested;
            return new RequestResultDto(state == CatalogState.None ? CatalogState.Requested : state, result.RequestStatus == SeerrRequestStatus.Pending);
        }
        catch (SeerrException e) when (e.Status == HttpStatusCode.Forbidden)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new ErrorDto(e.SeerrMessage ?? "Seerr didn't allow this request."));
        }
        catch (SeerrException e) when (e.Status == HttpStatusCode.Conflict)
        {
            return Conflict(new ErrorDto(e.SeerrMessage ?? "This has already been requested."));
        }
        catch (SeerrException e) when (e.Status == HttpStatusCode.Accepted)
        {
            return Conflict(new ErrorDto(e.SeerrMessage ?? "There's nothing left to request."));
        }
        catch (SeerrException e)
        {
            return SeerrUnavailable(e, "request");
        }
    }

    private async Task<IReadOnlyList<CatalogItemDto>> GetRecommendationsAsync(SeerrEndpoint endpoint, Caller caller, string mediaType, int tmdbId, CancellationToken cancellationToken)
    {
        try
        {
            var page = await _seerr.GetRecommendationsAsync(endpoint, caller.SeerrUserId, mediaType, tmdbId, cancellationToken).ConfigureAwait(false);
            return _mapper.ToItems(page.Results, caller.User, CatalogMapper.MaxRecommendations);
        }
        catch (SeerrException e)
        {
            // Recommendations are optional on the title page.
            if (_logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug("Lumen couldn't load Seerr recommendations: {Message}", e.Message);
            }

            return [];
        }
    }

    /// <summary>The signed-in user with catalog access, or the result to return instead (401, or 404 when they have no access).</summary>
    private async Task<Caller> GetCallerAsync(CancellationToken cancellationToken)
    {
        if (User.GetJellyfinUserId(_logger) is not { } userId)
        {
            return new Caller(Unauthorized());
        }

        var access = await _users.GetAccessAsync(userId, cancellationToken).ConfigureAwait(false);
        if (!access.Enabled || access.SeerrUserId is not { } seerrUserId || access.Endpoint is not { } endpoint)
        {
            return new Caller(NotFound());
        }

        return new Caller(null, userId, access, endpoint, seerrUserId, _userManager.GetUserById(userId));
    }

    private ObjectResult SeerrUnavailable(SeerrException e, string what)
    {
        // SeerrException messages never contain the API key.
        _logger.LogWarning("Lumen's Seerr {What} call failed: {Message}", what, e.Message);
        return StatusCode(StatusCodes.Status502BadGateway, new ErrorDto(Unavailable));
    }

    /// <summary>The signed-in caller. Its <c>ToString</c> never prints the API key (see <see cref="SeerrEndpoint.ToString"/>).</summary>
    private sealed record Caller(
        ActionResult? Failure, Guid UserId = default, RequestAccess? Access = null, SeerrEndpoint? Endpoint = null, int SeerrUserId = 0, User? User = null);
}
