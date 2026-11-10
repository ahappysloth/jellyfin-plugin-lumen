using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// Adds <see cref="IndexHtmlMiddleware"/> and <see cref="WebStaticMiddleware"/> ahead of Jellyfin's pipeline, and starts
/// compressing Lumen's client files (<see cref="AssetCatalog.StartPrecompression"/>) and jellyfin-web's startup bundles
/// (<see cref="WebStaticFiles.StartWarmup"/>) in the background as Jellyfin builds it.
/// </summary>
public sealed class LumenStartupFilter : IStartupFilter
{
    private readonly AssetCatalog _assets;
    private readonly WebStaticFiles _webFiles;
    private readonly ILumenConfigReader _config;
    private readonly ILogger<LumenStartupFilter> _logger;

    public LumenStartupFilter(AssetCatalog assets, WebStaticFiles webFiles, ILumenConfigReader config, ILogger<LumenStartupFilter> logger)
    {
        _assets = assets;
        _webFiles = webFiles;
        _config = config;
        _logger = logger;
    }

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        _ = _assets.StartPrecompression(_logger);
        _ = _webFiles.StartWarmup(() => _config.Current.OptimizeWebClientFiles);
        app.UseMiddleware<IndexHtmlMiddleware>();
        app.UseMiddleware<WebStaticMiddleware>();
        next(app);
    };
}
