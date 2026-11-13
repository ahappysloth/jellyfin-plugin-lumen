using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
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
    private readonly ILogger<TrailersController> _logger;

    public TrailersController(IOnlineTrailers online, ITrailerLookup trailers, ILibraryManager library, IUserManager users, ILumenConfigReader config, ILogger<TrailersController> logger)
    {
        _online = online;
        _trailers = trailers;
        _library = library;
        _users = users;
        _config = config;
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
}
