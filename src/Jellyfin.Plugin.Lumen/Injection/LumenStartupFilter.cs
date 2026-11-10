using Jellyfin.Plugin.Lumen.Assets;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// Adds <see cref="IndexHtmlMiddleware"/> ahead of Jellyfin's pipeline, and starts compressing Lumen's client files
/// in the background (<see cref="AssetCatalog.StartPrecompression"/>) as Jellyfin builds it.
/// </summary>
public sealed class LumenStartupFilter : IStartupFilter
{
    private readonly AssetCatalog _assets;
    private readonly ILogger<LumenStartupFilter> _logger;

    public LumenStartupFilter(AssetCatalog assets, ILogger<LumenStartupFilter> logger)
    {
        _assets = assets;
        _logger = logger;
    }

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        _ = _assets.StartPrecompression(_logger);
        app.UseMiddleware<IndexHtmlMiddleware>();
        next(app);
    };
}
