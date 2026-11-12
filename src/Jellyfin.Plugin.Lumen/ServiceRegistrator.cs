using System.Net.Http.Headers;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using Jellyfin.Plugin.Lumen.Injection;
using Jellyfin.Plugin.Lumen.Requests;
using Jellyfin.Plugin.Lumen.Storage;
using Jellyfin.Plugin.Lumen.Top10;
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
    /// <summary>Sent with every Seerr, TMDB and Trakt call, so their logs show who is calling.</summary>
    internal static readonly ProductInfoHeaderValue UserAgent =
        new("Jellyfin-Plugin-Lumen", typeof(LumenPlugin).Assembly.GetName().Version?.ToString(3) ?? "0");

    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton(AssetCatalog.FromEmbeddedResources(typeof(LumenPlugin).Assembly));
        serviceCollection.AddSingleton<WebStaticFiles>();
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
        serviceCollection.AddSingleton<IStorageScanner, StorageScanner>();
        serviceCollection.AddSingleton<StorageReportService>();

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

        // Trakt's key is a custom header too, so the same rule: no redirects (TraktClient reports one as an error).
        serviceCollection.AddHttpClient(TraktClient.HttpClientName, client => client.DefaultRequestHeaders.UserAgent.Add(UserAgent))
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false });
        serviceCollection.AddSingleton<ITraktClient, TraktClient>();
        serviceCollection.AddSingleton<ITop10Lists, Top10Lists>();

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
        serviceCollection.AddSingleton<IHomeSectionProvider, Top10MoviesProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, Top10ShowsProvider>();
    }
}
