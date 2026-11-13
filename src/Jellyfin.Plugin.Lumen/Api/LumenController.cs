using System.Text.Json;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Injection;
using MediaBrowser.Controller;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Client-facing endpoints: embedded assets, client config, and compatibility reports.</summary>
[ApiController]
[Route("Lumen")]
public sealed class LumenController : ControllerBase
{
    /// <summary>What <see cref="GetCacheProbe"/> sends, and an unversioned Lumen file too (client/src/admin/health/probes.ts).</summary>
    public const string ProbeCacheControl = "no-cache";

    /// <summary>The probe's body, which tells the page it reached Lumen and not a proxy's error page.</summary>
    public const string ProbeBody = "/* lumen-cache-probe */";

    private readonly AssetCatalog _assets;
    private readonly ILumenConfigReader _config;
    private readonly DiagnosticsStore _diagnostics;
    private readonly TimeProvider _time;
    private readonly IServerApplicationHost _host;
    private readonly ILogger<LumenController> _logger;

    public LumenController(AssetCatalog assets, ILumenConfigReader config, DiagnosticsStore diagnostics, TimeProvider time, IServerApplicationHost host, ILogger<LumenController> logger)
    {
        _assets = assets;
        _config = config;
        _diagnostics = diagnostics;
        _time = time;
        _host = host;
        _logger = logger;
    }

    /// <summary>
    /// The Health tab's proxy check: a tiny script beside Lumen's own files, sent with the headers an unversioned Lumen file
    /// gets (<see cref="ProbeCacheControl"/>, no Expires). A proxy that caches "assets" by extension (Nginx Proxy Manager's
    /// Cache Assets) rewrites these as it does Lumen's, and the page compares what it receives with what was sent.
    /// </summary>
    [HttpGet("Assets/cache-probe.js")]
    [AllowAnonymous]
    public IActionResult GetCacheProbe()
    {
        Response.Headers.CacheControl = ProbeCacheControl;
        return Content(ProbeBody, "text/javascript");
    }

    [HttpGet("Assets/{name}")]
    [AllowAnonymous]
    public IActionResult GetAsset([FromRoute] string name, [FromQuery] string? v)
    {
        if (!_assets.TryGet(name, out var asset))
        {
            return NotFound();
        }

        // A content-named chunk or font can't change under its name, so it's cached for good without a version.
        Response.Headers.CacheControl = string.Equals(v, _assets.BuildHash, StringComparison.Ordinal) || AssetCatalog.IsContentNamed(name)
            ? "public, max-age=31536000, immutable"
            : "no-cache";

        // Lumen's own files are static and hold no secret, so they're served precompressed over HTTPS too.
        var representation = asset.Select(Request.Headers.AcceptEncoding, _logger);
        if (asset.Compressible)
        {
            Response.Headers.Append(HeaderNames.Vary, HeaderNames.AcceptEncoding);
        }

        if (representation.ContentEncoding is { } encoding)
        {
            Response.Headers.ContentEncoding = encoding;
        }

        return File(representation.Content, asset.ContentType, lastModified: null, entityTag: representation.ETag);
    }

    /// <summary>
    /// The web app manifest (index.html points here instead of jellyfin-web's while Lumen is on): Lumen's name (or the
    /// server's, see <see cref="AppIdentity"/>), icons and colour, so "Add to Home Screen" and "Install app" get Lumen.
    /// Anonymous, as browsers fetch it without the user's token. Paths are relative to <c>/Lumen/</c> (under any base URL);
    /// the app itself still lives under /web/.
    /// </summary>
    [HttpGet("Manifest")]
    [AllowAnonymous]
    public IActionResult GetManifest()
    {
        var name = AppIdentity.Name(_config.Current, _host.FriendlyName);
        var version = Uri.EscapeDataString(_assets.BuildHash);
        var manifest = new
        {
            name,
            short_name = name,
            description = "Your Jellyfin server, by Lumen",
            start_url = "../web/index.html#/home",
            scope = "../web/",
            display = "standalone",

            // Either way up: the player wants landscape, the rest of the app portrait on a phone.
            orientation = "any",
            theme_color = AppIdentity.Color,
            background_color = AppIdentity.Color,
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
