using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class HeroServiceTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly ILinkedItemsReader _reader = Substitute.For<ILinkedItemsReader>();
    private readonly ITrailerLookup _trailers = Substitute.For<ITrailerLookup>();
    private readonly User _user = TestData.User();
    private InternalItemsQuery? _query;

    public HeroServiceTests()
    {
        _library.GetItemList(Arg.Do<InternalItemsQuery>(q => _query = q)).Returns(Array.Empty<BaseItem>());
    }

    [Fact]
    public void Rank_ExcludesItemsWithoutBackdrop()
    {
        var noArt = TestData.Movie("none");
        var posterOnly = TestData.Movie("poster").WithImages(ImageType.Primary);
        var backdrop = TestData.Movie("backdrop").WithImages(ImageType.Backdrop);

        Assert.Equal([backdrop], HeroService.Rank([noArt, posterOnly, backdrop], 5));
    }

    [Fact]
    public void Rank_PrefersLogos_KeepingRelativeOrder_AndLimits()
    {
        var a = TestData.Movie("a").WithImages(ImageType.Backdrop);
        var b = TestData.Movie("b").WithImages(ImageType.Backdrop, ImageType.Logo);
        var c = TestData.Movie("c").WithImages(ImageType.Backdrop);
        var d = TestData.Movie("d").WithImages(ImageType.Backdrop, ImageType.Logo);

        Assert.Equal([b, d, a], HeroService.Rank([a, b, c, d], 3));
    }

    [Fact]
    public async Task RecentlyAdded_QueriesNewestWithBackdrops_AndAttachesTrailers()
    {
        var movie = TestData.Movie("m").WithImages(ImageType.Backdrop);
        var trailerId = Guid.NewGuid();
        _library.GetItemList(Arg.Do<InternalItemsQuery>(q => _query = q)).Returns(new BaseItem[] { movie });
        _trailers.GetLocalTrailerId(movie, _user).Returns(trailerId);

        var hero = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { HeroCount = 5 }, CancellationToken.None);

        Assert.Equal(new HeroItem(movie, trailerId), Assert.Single(hero));
        Assert.Equal((ItemSortBy.DateCreated, SortOrder.Descending), Assert.Single(_query!.OrderBy));
        Assert.Equal([ImageType.Backdrop], _query.ImageTypes);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Series], _query.IncludeItemTypes);
        Assert.Equal(20, _query.Limit);
    }

    [Fact]
    public async Task TopRatedUnplayed_FiltersPlayed_AndSortsByRating()
    {
        await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { HeroSource = HeroSource.TopRatedUnplayed }, CancellationToken.None);

        Assert.False(_query!.IsPlayed);
        Assert.Equal((ItemSortBy.CommunityRating, SortOrder.Descending), Assert.Single(_query.OrderBy));
    }

    [Fact]
    public async Task Collection_UsesReader_AndEmptyWithoutId()
    {
        var id = Guid.NewGuid();
        var movie = TestData.Movie("c").WithImages(ImageType.Backdrop);
        _reader.GetCollection(id, _user).Returns(new CuratedSource("Featured", [movie]));

        var withId = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { HeroSource = HeroSource.Collection, HeroCollectionId = id }, CancellationToken.None);
        var withoutId = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { HeroSource = HeroSource.Collection }, CancellationToken.None);

        Assert.Equal(movie, Assert.Single(withId).Item);
        Assert.Empty(withoutId);
        Assert.Null(_query);
    }

    private HeroService Create() => new(_library, _reader, _trailers);
}
