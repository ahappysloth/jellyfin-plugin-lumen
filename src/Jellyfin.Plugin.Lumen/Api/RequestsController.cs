using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Catalog browsing and requests via Seerr, for the signed-in user (requests design spec, §4.1).</summary>
[ApiController]
[Route("Lumen/Requests")]
[Authorize]
public sealed class RequestsController : ControllerBase
{
    private readonly ISeerrUserMap _users;
    private readonly ITmdbImageCache _images;

    public RequestsController(ISeerrUserMap users, ITmdbImageCache images)
    {
        _users = users;
        _images = images;
    }

    /// <summary>Whether the catalog is available to this user, and what they may request.</summary>
    [HttpGet("Status")]
    public async Task<ActionResult<RequestStatusDto>> GetStatus(CancellationToken cancellationToken)
    {
        if (User.GetJellyfinUserId() is not { } userId)
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

        if (User.GetJellyfinUserId() is not { } userId || !(await _users.GetAccessAsync(userId, cancellationToken).ConfigureAwait(false)).Enabled)
        {
            return NotFound();
        }

        CachedImage? image;
        try
        {
            image = await _images.GetAsync(size, file, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or IOException)
        {
            return StatusCode(StatusCodes.Status502BadGateway);
        }

        if (image is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "private, max-age=604800, immutable";
        return PhysicalFile(image.Path, image.ContentType);
    }
}
