using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Injection;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.TV;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests;

public class ServiceRegistratorTests
{
    [Fact]
    public async Task RegistersACompleteValidGraph()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(Substitute.For<ILibraryManager>());
        services.AddSingleton(Substitute.For<IUserDataManager>());
        services.AddSingleton(Substitute.For<IUserManager>());
        services.AddSingleton(Substitute.For<ITVSeriesManager>());
        services.AddSingleton(Substitute.For<ISimilarItemsManager>());
        services.AddSingleton(Substitute.For<IDtoService>());
        services.AddSingleton(Substitute.For<IHttpClientFactory>());
        services.AddSingleton(Substitute.For<IApplicationPaths>());
        services.AddSingleton(Substitute.For<MediaBrowser.Common.Updates.IInstallationManager>());
        services.AddSingleton(Substitute.For<MediaBrowser.Controller.Configuration.IServerConfigurationManager>());
        services.AddSingleton<Microsoft.Extensions.Configuration.IConfiguration>(new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build());

        new ServiceRegistrator().RegisterServices(services, Substitute.For<IServerApplicationHost>());
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });

        Assert.NotNull(provider.GetRequiredService<IHomeService>());
        Assert.NotNull(provider.GetRequiredService<ILumenConfigStore>());
        Assert.Same(provider.GetRequiredService<LumenConfigReader>(), provider.GetRequiredService<ILumenConfigReader>());
        Assert.NotNull(provider.GetRequiredService<AssetCatalog>());
        Assert.NotNull(provider.GetRequiredService<ISeerrUserMap>());
        Assert.NotNull(provider.GetRequiredService<ITmdbImageCache>());
        Assert.NotNull(provider.GetRequiredService<CatalogMapper>());
        Assert.NotNull(provider.GetRequiredService<WebStaticFiles>());
        Assert.Contains(provider.GetServices<IStartupFilter>(), f => f is LumenStartupFilter);
        Assert.Equal(
            [
                SectionTypes.BecauseYouWatched, SectionTypes.CatalogPopularMovies, SectionTypes.CatalogPopularShows, SectionTypes.CatalogTrending,
                SectionTypes.CatalogUpcoming, SectionTypes.ContinueWatching, SectionTypes.Curated, SectionTypes.Genre, SectionTypes.Genres,
                SectionTypes.MyRequests, SectionTypes.NewForYou, SectionTypes.NextUp, SectionTypes.RecentlyAdded,
            ],
            provider.GetServices<IHomeSectionProvider>().Select(p => p.Type).Order(StringComparer.Ordinal));

        // Building Jellyfin's pipeline starts compressing the client files in the background.
        var catalog = provider.GetRequiredService<AssetCatalog>();
        Assert.Null(catalog.Precompression);
        var filter = Assert.Single(provider.GetServices<IStartupFilter>().OfType<LumenStartupFilter>());
        filter.Configure(_ => { })(new ApplicationBuilder(provider));
        await catalog.Precompression!;
        Assert.True(catalog.TryGet("lumen.css", out var css));
        Assert.True(css.IsPrecompressed);

        // The admin page shows each section's one-sentence description.
        Assert.All(provider.GetServices<IHomeSectionProvider>(), p => Assert.EndsWith(".", p.Description, StringComparison.Ordinal));
    }
}
