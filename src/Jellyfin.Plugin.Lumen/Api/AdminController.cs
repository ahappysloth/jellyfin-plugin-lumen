using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
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

    public AdminController(ILumenConfigStore store, IEnumerable<IHomeSectionProvider> providers, DiagnosticsStore diagnostics)
    {
        _store = store;
        _providers = providers;
        _diagnostics = diagnostics;
    }

    [HttpGet("Config")]
    public ActionResult<PluginConfiguration> GetConfig() => _store.Current;

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

    [HttpGet("Diagnostics")]
    public ActionResult<IReadOnlyList<DiagnosticEntry>> GetDiagnostics() => Ok(_diagnostics.GetAll());
}
