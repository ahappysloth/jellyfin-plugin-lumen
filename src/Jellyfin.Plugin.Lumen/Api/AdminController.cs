using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Admin-only endpoints used by the Lumen dashboard page.</summary>
[ApiController]
[Route("Lumen/Admin")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class AdminController : ControllerBase
{
    private readonly ILumenConfigStore _store;
    private readonly IEnumerable<IHomeSectionProvider> _providers;
    private readonly DiagnosticsStore _diagnostics;
    private readonly ISeerrClient _seerr;
    private readonly IUserManager _users;
    private readonly IServerApplicationHost _host;

    public AdminController(
        ILumenConfigStore store,
        IEnumerable<IHomeSectionProvider> providers,
        DiagnosticsStore diagnostics,
        ISeerrClient seerr,
        IUserManager users,
        IServerApplicationHost host)
    {
        _store = store;
        _providers = providers;
        _diagnostics = diagnostics;
        _seerr = seerr;
        _users = users;
        _host = host;
    }

    /// <summary>The configuration, minus the Seerr API key (the page only learns whether one is set).</summary>
    [HttpGet("Config")]
    public ActionResult<PluginConfiguration> GetConfig() => _store.Current.WithoutSecrets();

    [HttpPost("Config")]
    public IActionResult SaveConfig([FromBody] PluginConfiguration config)
    {
        var result = _store.Save(config);
        return result.Success ? NoContent() : BadRequest(new ValidationErrorsDto(result.Errors));
    }

    [HttpPost("Config/Reset")]
    public IActionResult Reset()
    {
        _store.ResetToDefaults();
        return NoContent();
    }

    [HttpGet("SectionTypes")]
    public ActionResult<IReadOnlyList<SectionTypeDto>> GetSectionTypes() =>
        Ok(_providers.Select(SectionTypeDto.From).OrderBy(t => t.DisplayName, StringComparer.OrdinalIgnoreCase).ToList());

    /// <summary>Checks a Seerr address and key (the stored key when none is given) without saving them.</summary>
    [HttpPost("Seerr/Test")]
    public async Task<ActionResult<SeerrTestResultDto>> TestSeerr([FromBody] SeerrTestRequestDto body, CancellationToken cancellationToken)
    {
        if (!ConfigValidator.IsHttpUrl(body.Url))
        {
            return new SeerrTestResultDto(false, null, "Enter Seerr's address, like http://seerr:5055.");
        }

        // The stored key is only reused for the stored address: testing a new (maybe mistyped) address must never send
        // the saved key to it.
        var reuse = string.IsNullOrEmpty(body.ApiKey) && ConfigValidator.SameSeerr(body.Url, _store.Current.SeerrUrl);
        var key = reuse ? _store.Current.SeerrApiKey : body.ApiKey;
        if (string.IsNullOrWhiteSpace(key))
        {
            return new SeerrTestResultDto(
                false,
                null,
                string.IsNullOrEmpty(_store.Current.SeerrApiKey) ? "Enter Seerr's API key." : "Enter the API key for this new address.");
        }

        var endpoint = new SeerrEndpoint(new Uri(body.Url!.TrimEnd('/') + "/"), key);
        try
        {
            var status = await _seerr.GetStatusAsync(endpoint, cancellationToken).ConfigureAwait(false);

            // /status answers without a key, so prove the key works with a call that needs it.
            await _seerr.GetUserByJellyfinIdAsync(endpoint, Guid.Empty, cancellationToken).ConfigureAwait(false);
            var server = await TryGetJellyfinServerAsync(endpoint, cancellationToken).ConfigureAwait(false);
            return new SeerrTestResultDto(true, status.Version, null, server?.Name, server?.Is(_host.SystemId));
        }
        catch (SeerrException e)
        {
            return new SeerrTestResultDto(false, null, e.Message);
        }
    }

    /// <summary>
    /// Which Jellyfin server Seerr is linked to, and the users here with no Seerr account (they see no catalog).
    /// Empty when requests are off.
    /// </summary>
    [HttpGet("Seerr/Users")]
    public async Task<ActionResult<SeerrUsersDto>> GetSeerrUsers(CancellationToken cancellationToken)
    {
        if (SeerrEndpoint.From(_store.Current) is not { } endpoint)
        {
            return new SeerrUsersDto(null, null, []);
        }

        var unmapped = new List<UnmappedUserDto>();
        SeerrJellyfinServer? server;
        try
        {
            server = await TryGetJellyfinServerAsync(endpoint, cancellationToken).ConfigureAwait(false);
            foreach (var user in _users.GetUsers())
            {
                if (await _seerr.GetUserByJellyfinIdAsync(endpoint, user.Id, cancellationToken).ConfigureAwait(false) is null)
                {
                    unmapped.Add(new UnmappedUserDto(user.Id, user.Username));
                }
            }
        }
        catch (SeerrException e)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new ValidationErrorsDto([e.Message]));
        }

        return new SeerrUsersDto(server?.Name, server?.Is(_host.SystemId), unmapped);
    }

    [HttpGet("Diagnostics")]
    public ActionResult<IReadOnlyList<DiagnosticEntry>> GetDiagnostics() => Ok(_diagnostics.GetAll());

    /// <summary>Seerr's linked Jellyfin server; null if Seerr uses Plex/Emby, or the settings can't be read.</summary>
    private async Task<SeerrJellyfinServer?> TryGetJellyfinServerAsync(SeerrEndpoint endpoint, CancellationToken cancellationToken)
    {
        try
        {
            return await _seerr.GetJellyfinServerAsync(endpoint, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException)
        {
            return null;
        }
    }
}
