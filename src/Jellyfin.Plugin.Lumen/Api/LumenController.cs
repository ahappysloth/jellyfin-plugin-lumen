using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Client-facing endpoints: embedded assets, client config, and compatibility reports.</summary>
[ApiController]
[Route("Lumen")]
public sealed class LumenController : ControllerBase
{
    private readonly AssetCatalog _assets;
    private readonly ILumenConfigStore _config;
    private readonly DiagnosticsStore _diagnostics;
    private readonly TimeProvider _time;

    public LumenController(AssetCatalog assets, ILumenConfigStore config, DiagnosticsStore diagnostics, TimeProvider time)
    {
        _assets = assets;
        _config = config;
        _diagnostics = diagnostics;
        _time = time;
    }

    [HttpGet("Assets/{name}")]
    [AllowAnonymous]
    public IActionResult GetAsset([FromRoute] string name, [FromQuery] string? v)
    {
        if (!_assets.TryGet(name, out var asset))
        {
            return NotFound();
        }

        Response.Headers.CacheControl = string.Equals(v, _assets.BuildHash, StringComparison.Ordinal)
            ? "public, max-age=31536000, immutable"
            : "no-cache";
        return File(asset.Content, asset.ContentType);
    }

    [HttpGet("ClientConfig")]
    [Authorize]
    public ActionResult<ClientConfigDto> GetClientConfig() => ClientConfigDto.From(_config.Current, _assets.BuildHash);

    [HttpPost("Diagnostics")]
    [Authorize]
    public IActionResult PostDiagnostics([FromBody] CompatReportDto report)
    {
        _diagnostics.Record(report, _time.GetUtcNow());
        return NoContent();
    }
}
