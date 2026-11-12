using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Trakt;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Admin-only: checks a Trakt key for the Trakt rows and Top charts (the dashboard's Check key button).</summary>
[ApiController]
[Route("Lumen/Admin/Trakt")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class TraktAdminController : ControllerBase
{
    private readonly ILumenConfigReader _config;
    private readonly ITraktClient _trakt;

    public TraktAdminController(ILumenConfigReader config, ITraktClient trakt)
    {
        _config = config;
        _trakt = trakt;
    }

    /// <summary>Asks Trakt for this week's top movie with the key given (the stored key when none is), without saving it.</summary>
    [HttpPost("Test")]
    public async Task<ActionResult<TraktTestResultDto>> Test([FromBody] TraktTestRequestDto body, CancellationToken cancellationToken)
    {
        var key = string.IsNullOrWhiteSpace(body.ClientId) ? _config.Current.TraktClientId : body.ClientId.Trim();
        if (string.IsNullOrWhiteSpace(key))
        {
            return new TraktTestResultDto(false, null, "Paste a Trakt Client ID first.");
        }

        // Checked before it goes in a header: a pasted key with a line break inside would otherwise fail as a 500.
        if (!ConfigValidator.IsTraktKey(key))
        {
            return new TraktTestResultDto(false, null, "That doesn't look like a Trakt Client ID (trakt.tv/oauth/applications).");
        }

        try
        {
            var titles = await _trakt.GetTitlesAsync(key, TraktQuery.Watched(TraktListKind.Movies, TraktPeriod.Weekly) with { Limit = 1 }, cancellationToken).ConfigureAwait(false);
            return new TraktTestResultDto(true, titles.Count > 0 ? titles[0].Title : null, null);
        }
        catch (TraktException e)
        {
            return new TraktTestResultDto(false, null, e.Message);
        }
    }
}

/// <summary>Body of POST /Lumen/Admin/Trakt/Test. A null or empty key means "use the stored key".</summary>
public sealed record TraktTestRequestDto(string? ClientId);

/// <summary>Result of a Trakt key check: on success, this week's most watched movie (as a sign it really works).</summary>
public sealed record TraktTestResultDto(bool Ok, string? TopMovie, string? Error);
