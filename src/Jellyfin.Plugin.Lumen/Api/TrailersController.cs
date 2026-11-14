using System.Globalization;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>
/// The details page's way to a title's trailer online (the home hero's slides carry theirs, see
/// <see cref="HeroItemDto"/>): asked only for a title without a local trailer, while "Use online trailers" is on.
/// </summary>
[ApiController]
[Route("Lumen")]
[Authorize]
public sealed class TrailersController : ControllerBase
{
    private readonly IOnlineTrailers _online;
    private readonly ITrailerLookup _trailers;
    private readonly ILibraryManager _library;
    private readonly IUserManager _users;
    private readonly ILumenConfigReader _config;
    private readonly TrailerRefreshLimiter _limiter;
    private readonly ILogger<TrailersController> _logger;

    public TrailersController(
        IOnlineTrailers online,
        ITrailerLookup trailers,
        ILibraryManager library,
        IUserManager users,
        ILumenConfigReader config,
        TrailerRefreshLimiter limiter,
        ILogger<TrailersController> logger)
    {
        _online = online;
        _trailers = trailers;
        _library = library;
        _users = users;
        _config = config;
        _limiter = limiter;
        _logger = logger;
    }

    /// <summary>
    /// The item's trailer online: on IMDb, else the YouTube video id; both null when the setting is off, the item has a
    /// local trailer (which wins), or none is known. 404 for an item the user can't see, and while Lumen is switched off.
    /// </summary>
    [HttpGet("Items/{itemId}/Trailer")]
    public async Task<ActionResult<OnlineTrailerDto>> GetTrailer([FromRoute] Guid itemId, CancellationToken cancellationToken)
    {
        var user = User.GetJellyfinUserId(_logger) is { } id ? _users.GetUserById(id) : null;
        if (user is null)
        {
            return Unauthorized();
        }

        var config = _config.Current;
        if (!config.Enabled || _library.GetItemById<BaseItem>(itemId, user) is not { } item)
        {
            return NotFound();
        }

        if (!config.TrailerPreview || !config.YouTubeTrailers || _trailers.GetLocalTrailerId(item, user) is not null)
        {
            return OnlineTrailerDto.From(OnlineTrailer.None);
        }

        return OnlineTrailerDto.From(await _online.GetAsync(item, user, cancellationToken).ConfigureAwait(false));
    }

    /// <summary>
    /// For the Trailer section of the item's Media info: what the server found of its trailer and why (TrailerInfoDto),
    /// as the hero and the title page get it, from the same caches. Anyone who can see the item may read it: it holds no
    /// address. Its own call, so the trailer calls stay as small and quick as they are. 404 as for the trailer.
    /// </summary>
    [HttpGet("Items/{itemId}/TrailerInfo")]
    public Task<ActionResult<TrailerInfoDto>> GetTrailerInfo([FromRoute] Guid itemId, CancellationToken cancellationToken) =>
        TrailerInfoAsync(itemId, false, cancellationToken);

    /// <summary>
    /// "Check again": the same, asking IMDb and Seerr again past the cache, for everyone's next trailer. Administrators
    /// only (Jellyfin's policy, and this action itself should the attribute ever be lost), and limited per user and title
    /// (TrailerRefreshLimiter): 429 with Retry-After past that.
    /// </summary>
    [HttpPost("Items/{itemId}/TrailerInfo/Refresh")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public Task<ActionResult<TrailerInfoDto>> RefreshTrailerInfo([FromRoute] Guid itemId, CancellationToken cancellationToken) =>
        TrailerInfoAsync(itemId, true, cancellationToken);

    /// <summary>
    /// Whether <paramref name="limiter"/> lets <paramref name="userId"/> check <paramref name="title"/> again now; if
    /// not, the 429 to answer with (its Retry-After set).
    /// </summary>
    internal static ObjectResult? Limited(ControllerBase controller, TrailerRefreshLimiter limiter, Guid userId, string title)
    {
        if (limiter.TryAcquire(userId, title, out var retryAfter))
        {
            return null;
        }

        controller.Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds).ToString(CultureInfo.InvariantCulture);
        return controller.StatusCode(StatusCodes.Status429TooManyRequests, new ErrorDto("Checked again a moment ago. Try again shortly."));
    }

    /// <summary>Whether the user is a Jellyfin administrator: the only one who may check a title's trailer again.</summary>
    internal static bool IsAdmin(User? user) => user?.HasPermission(PermissionKind.IsAdministrator) == true;

    private async Task<ActionResult<TrailerInfoDto>> TrailerInfoAsync(Guid itemId, bool refresh, CancellationToken cancellationToken)
    {
        var user = User.GetJellyfinUserId(_logger) is { } id ? _users.GetUserById(id) : null;
        if (user is null)
        {
            return Unauthorized();
        }

        var admin = IsAdmin(user);
        if (refresh && !admin)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new ErrorDto("Only administrators can check a trailer again."));
        }

        if (!_config.Current.Enabled || _library.GetItemById<BaseItem>(itemId, user) is not { } item)
        {
            return NotFound();
        }

        if (refresh && Limited(this, _limiter, user.Id, itemId.ToString("N")) is { } limited)
        {
            return limited;
        }

        Response.Headers.CacheControl = "no-store";
        var local = _trailers.GetLocalTrailerId(item, user) is not null;
        var diagnosis = await _online.DiagnoseAsync(item, user, local, refresh, cancellationToken).ConfigureAwait(false);
        return TrailerInfoDto.From(diagnosis, admin);
    }
}
