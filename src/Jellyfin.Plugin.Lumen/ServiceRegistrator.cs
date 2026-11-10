using System.Net.Http.Headers;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using Jellyfin.Plugin.Lumen.Injection;
using Jellyfin.Plugin.Lumen.Requests;
using Jellyfin.Plugin.Lumen.Updates;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Jellyfin.Plugin.Lumen;

/// <summary>Registers Lumen services with Jellyfin's web host container.</summary>
public sealed class ServiceRegistrator : IPluginServiceRegistrator
{
    /// <summary>Sent with every Seerr and TMDB call, so their logs show who is calling.</summary>
    internal static readonly ProductInfoHeaderValue UserAgent =
        new("Jellyfin-Plugin-Lumen", typeof(LumenPlugin).Assembly.GetName().Version?.ToString(3) ?? "0");

    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton(AssetCatalog.FromEmbeddedResources(typeof(LumenPlugin).Assembly));
        serviceCollection.AddTransient<IStartupFilter, LumenStartupFilter>();
        serviceCollection.TryAddSingleton(TimeProvider.System);

        serviceCollection.AddSingleton<IPluginConfigPersistence, LumenPluginPersistence>();
        serviceCollection.AddSingleton<ILibraryCatalog, LibraryCatalog>();
        serviceCollection.AddSingleton<ConfigValidator>();
        serviceCollection.AddSingleton<LumenConfigReader>();
        serviceCollection.AddSingleton<ILumenConfigReader>(services => services.GetRequiredService<LumenConfigReader>());
        serviceCollection.AddSingleton<ILumenConfigStore, LumenConfigStore>();
        serviceCollection.AddSingleton<DiagnosticsStore>();
        serviceCollection.AddSingleton<UpdateChecker>();

        serviceCollection.AddSingleton<HomeCache>();
        serviceCollection.AddSingleton<IWatchHistoryService, WatchHistoryService>();
        serviceCollection.AddSingleton<ILinkedItemsReader, LinkedItemsReader>();
        serviceCollection.AddSingleton<ITrailerLookup, TrailerLookup>();
        serviceCollection.AddSingleton<IHeroService, HeroService>();
        serviceCollection.AddSingleton<IHomeDtoMapper, HomeDtoMapper>();
        serviceCollection.AddSingleton<IBadgeService, BadgeService>();
        serviceCollection.AddSingleton<IHomeService, HomeService>();

        // The Seerr client carries the admin API key in a custom header, which .NET keeps when it follows a redirect (only
        // Authorization is dropped). So it never follows one: the key only ever goes to the configured address, and
        // SeerrClient reports a redirect as an error.
        serviceCollection.AddHttpClient(SeerrClient.HttpClientName, client => client.DefaultRequestHeaders.UserAgent.Add(UserAgent))
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false });
        serviceCollection.AddHttpClient(TmdbImageCache.HttpClientName, client => client.DefaultRequestHeaders.UserAgent.Add(UserAgent));
        serviceCollection.AddSingleton<ISeerrClient, SeerrClient>();
        serviceCollection.AddSingleton<ISeerrUserMap, SeerrUserMap>();
        serviceCollection.AddSingleton<ITmdbImageCache, TmdbImageCache>();
        serviceCollection.AddSingleton<CatalogMapper>();
        serviceCollection.AddSingleton<CatalogRowAccess>();

        serviceCollection.AddSingleton<IHomeSectionProvider, ContinueWatchingProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, NextUpProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, RecentlyAddedProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, BecauseYouWatchedProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, GenreProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, NewForYouProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, CuratedProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, GenresProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, CatalogTrendingProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, CatalogPopularMoviesProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, CatalogPopularShowsProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, CatalogUpcomingProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, MyRequestsProvider>();
    }
}
