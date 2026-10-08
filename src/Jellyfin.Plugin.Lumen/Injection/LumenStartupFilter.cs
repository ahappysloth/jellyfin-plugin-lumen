using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>Adds <see cref="IndexHtmlMiddleware"/> ahead of Jellyfin's pipeline.</summary>
public sealed class LumenStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.UseMiddleware<IndexHtmlMiddleware>();
        next(app);
    };
}
