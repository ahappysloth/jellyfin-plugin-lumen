using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Injection;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Jellyfin.Plugin.Lumen;

/// <summary>Registers Lumen services with Jellyfin's web host container.</summary>
public sealed class ServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton(AssetCatalog.FromEmbeddedResources(typeof(LumenPlugin).Assembly));
        serviceCollection.AddTransient<IStartupFilter, LumenStartupFilter>();
        serviceCollection.TryAddSingleton(TimeProvider.System);
        serviceCollection.AddSingleton<IPluginConfigPersistence, LumenPluginPersistence>();
        serviceCollection.AddSingleton<ILibraryCatalog, LibraryCatalog>();
        serviceCollection.AddSingleton<ConfigValidator>();
        serviceCollection.AddSingleton<ILumenConfigStore, LumenConfigStore>();
        serviceCollection.AddSingleton<DiagnosticsStore>();
    }
}
