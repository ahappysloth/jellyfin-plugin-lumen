using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Common.Api;
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

    public AdminController(
        ILumenConfigStore store,
        IEnumerable<IHomeSectionProvider> providers,
        DiagnosticsStore diagnostics,
        ISeerrClient seerr,
        IUserManager users)
    {
        _store = store;
        _providers = providers;
        _diagnostics = diagnostics;
        _seerr = seerr;
        _users = users;
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
        var key = string.IsNullOrEmpty(body.ApiKey) ? _store.Current.SeerrApiKey : body.ApiKey;
        if (!ConfigValidator.IsHttpUrl(body.Url))
        {
            return new SeerrTestResultDto(false, null, "Enter Seerr's address, like http://seerr:5055.");
        }

        if (string.IsNullOrWhiteSpace(key))
        {
            return new SeerrTestResultDto(false, null, "Enter Seerr's API key.");
        }

        try
        {
            var status = await _seerr.GetStatusAsync(new SeerrEndpoint(new Uri(body.Url!.TrimEnd('/') + "/"), key), cancellationToken).ConfigureAwait(false);

            // /status answers without a key, so prove the key works with a call that needs it.
            await _seerr.GetUserByJellyfinIdAsync(new SeerrEndpoint(new Uri(body.Url!.TrimEnd('/') + "/"), key), Guid.Empty, cancellationToken).ConfigureAwait(false);
            return new SeerrTestResultDto(true, status.Version, null);
        }
        catch (SeerrException e)
        {
            return new SeerrTestResultDto(false, null, e.Message);
        }
    }

    /// <summary>Jellyfin users with no Seerr account (they see no catalog). Empty when requests are off.</summary>
    [HttpGet("Seerr/UnmappedUsers")]
    public async Task<ActionResult<IReadOnlyList<UnmappedUserDto>>> GetUnmappedUsers(CancellationToken cancellationToken)
    {
        if (SeerrEndpoint.From(_store.Current) is not { } endpoint)
        {
            return Ok(Array.Empty<UnmappedUserDto>());
        }

        var unmapped = new List<UnmappedUserDto>();
        try
        {
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

        return Ok(unmapped);
    }

    [HttpGet("Diagnostics")]
    public ActionResult<IReadOnlyList<DiagnosticEntry>> GetDiagnostics() => Ok(_diagnostics.GetAll());
}
