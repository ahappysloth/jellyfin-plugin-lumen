using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Injection;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.TV;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests;

public class ServiceRegistratorTests
{
    [Fact]
    public void RegistersACompleteValidGraph()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(Substitute.For<ILibraryManager>());
        services.AddSingleton(Substitute.For<IUserDataManager>());
        services.AddSingleton(Substitute.For<IUserManager>());
        services.AddSingleton(Substitute.For<ITVSeriesManager>());
        services.AddSingleton(Substitute.For<ISimilarItemsManager>());
        services.AddSingleton(Substitute.For<IDtoService>());

        new ServiceRegistrator().RegisterServices(services, Substitute.For<IServerApplicationHost>());
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });

        Assert.NotNull(provider.GetRequiredService<IHomeService>());
        Assert.NotNull(provider.GetRequiredService<ILumenConfigStore>());
        Assert.NotNull(provider.GetRequiredService<AssetCatalog>());
        Assert.Contains(provider.GetServices<IStartupFilter>(), f => f is LumenStartupFilter);
        Assert.Equal(
            [SectionTypes.BecauseYouWatched, SectionTypes.ContinueWatching, SectionTypes.Curated, SectionTypes.Genre, SectionTypes.NewForYou, SectionTypes.NextUp, SectionTypes.RecentlyAdded],
            provider.GetServices<IHomeSectionProvider>().Select(p => p.Type).Order());
    }
}
