using System.Text.Json;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using MediaBrowser.Controller;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Client-facing endpoints: embedded assets, client config, and compatibility reports.</summary>
[ApiController]
[Route("Lumen")]
public sealed class LumenController : ControllerBase
{
    /// <summary>The installed app's background and status-bar colour (Lumen's page background).</summary>
    public const string PwaColor = "#0f0f0f";

    private readonly AssetCatalog _assets;
    private readonly ILumenConfigReader _config;
    private readonly DiagnosticsStore _diagnostics;
    private readonly TimeProvider _time;
    private readonly IServerApplicationHost _host;

    public LumenController(AssetCatalog assets, ILumenConfigReader config, DiagnosticsStore diagnostics, TimeProvider time, IServerApplicationHost host)
    {
        _assets = assets;
        _config = config;
        _diagnostics = diagnostics;
        _time = time;
        _host = host;
    }

    [HttpGet("Assets/{name}")]
    [AllowAnonymous]
    public IActionResult GetAsset([FromRoute] string name, [FromQuery] string? v)
    {
        if (!_assets.TryGet(name, out var asset))
        {
            return NotFound();
        }

        // A content-named chunk can't change under its name, so it's cached for good without a version.
        Response.Headers.CacheControl = string.Equals(v, _assets.BuildHash, StringComparison.Ordinal) || name.StartsWith(AssetCatalog.ChunkPrefix, StringComparison.Ordinal)
            ? "public, max-age=31536000, immutable"
            : "no-cache";
        return File(asset.Content, asset.ContentType);
    }

    /// <summary>
    /// The web app manifest (index.html points here instead of jellyfin-web's): the server's name and Lumen's icons, so
    /// "Add to Home Screen" gets the J. Paths are relative to <c>/Lumen/</c>; the app itself still lives under /web/.
    /// </summary>
    [HttpGet("Manifest")]
    [AllowAnonymous]
    public IActionResult GetManifest()
    {
        var name = string.IsNullOrWhiteSpace(_host.FriendlyName) ? "Jellyfin" : _host.FriendlyName;
        var version = Uri.EscapeDataString(_assets.BuildHash);
        var manifest = new
        {
            name,
            short_name = name,
            description = "Your Jellyfin server, by Lumen",
            start_url = "../web/index.html#/home",
            scope = "../web/",
            display = "standalone",
            theme_color = PwaColor,
            background_color = PwaColor,
            icons = new object[]
            {
                new { src = $"Assets/lumen-icon-192.png?v={version}", sizes = "192x192", type = "image/png", purpose = "any" },
                new { src = $"Assets/lumen-icon-512.png?v={version}", sizes = "512x512", type = "image/png", purpose = "any" },
                new { src = $"Assets/lumen-icon-maskable-512.png?v={version}", sizes = "512x512", type = "image/png", purpose = "maskable" },
            },
        };
        Response.Headers.CacheControl = "no-cache";
        return Content(JsonSerializer.Serialize(manifest), "application/manifest+json");
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
