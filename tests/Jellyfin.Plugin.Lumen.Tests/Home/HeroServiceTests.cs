using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class HeroServiceTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly ILinkedItemsReader _reader = Substitute.For<ILinkedItemsReader>();
    private readonly ITrailerLookup _trailers = Substitute.For<ITrailerLookup>();
    private readonly IYouTubeTrailers _youTube = Substitute.For<IYouTubeTrailers>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
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

    [Fact]
    public async Task YouTubeTrailers_Off_AreNotLookedUp()
    {
        var movie = TestData.Movie("m").WithImages(ImageType.Backdrop);
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(new BaseItem[] { movie });
        _youTube.GetAsync(default!, default!, default).ReturnsForAnyArgs("dQw4w9WgXcQ");

        var off = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration(), CancellationToken.None);
        var noPreviews = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { YouTubeTrailers = true, TrailerPreview = false }, CancellationToken.None);

        Assert.Null(Assert.Single(off).TrailerYouTubeId);
        Assert.Null(Assert.Single(noPreviews).TrailerYouTubeId);
        Assert.Empty(_youTube.ReceivedCalls());
    }

    [Fact]
    public async Task YouTubeTrailers_On_FillInForSlidesWithoutALocalTrailer_WhichAlwaysWins()
    {
        var local = TestData.Movie("local").WithImages(ImageType.Backdrop);
        var remote = TestData.Movie("remote").WithImages(ImageType.Backdrop);
        var none = TestData.Movie("none").WithImages(ImageType.Backdrop);
        var trailerId = Guid.NewGuid();
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(new BaseItem[] { local, remote, none });
        _trailers.GetLocalTrailerId(local, _user).Returns(trailerId);
        _youTube.GetAsync(local, _user, Arg.Any<CancellationToken>()).Returns("localHasOne");
        _youTube.GetAsync(remote, _user, Arg.Any<CancellationToken>()).Returns("dQw4w9WgXcQ");
        _youTube.GetAsync(none, _user, Arg.Any<CancellationToken>()).Returns((string?)null);

        var hero = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { YouTubeTrailers = true }, CancellationToken.None);

        Assert.Equal([new HeroItem(local, trailerId), new HeroItem(remote, null, "dQw4w9WgXcQ"), new HeroItem(none, null)], hero);
        await _youTube.DidNotReceive().GetAsync(local, Arg.Any<User>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task YouTubeLookup_ThatFailsOrOutlastsItsBudget_CostsOnlyThatSlideItsTrailer()
    {
        var slow = TestData.Movie("slow").WithImages(ImageType.Backdrop);
        var broken = TestData.Movie("broken").WithImages(ImageType.Backdrop);
        var quick = TestData.Movie("quick").WithImages(ImageType.Backdrop);
        var pending = new TaskCompletionSource<string?>();
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(new BaseItem[] { slow, broken, quick });
        _youTube.GetAsync(slow, _user, Arg.Any<CancellationToken>()).Returns(pending.Task);
        _youTube.GetAsync(broken, _user, Arg.Any<CancellationToken>()).ThrowsAsync(new InvalidOperationException("boom"));
        _youTube.GetAsync(quick, _user, Arg.Any<CancellationToken>()).Returns("dQw4w9WgXcQ");
        using var cancelled = new CancellationTokenSource();

        var build = Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { YouTubeTrailers = true }, cancelled.Token);
        Assert.False(build.IsCompleted);
        _time.Advance(HeroService.YouTubeBudget);
        var hero = await build;

        Assert.Equal([new HeroItem(slow, null), new HeroItem(broken, null), new HeroItem(quick, null, "dQw4w9WgXcQ")], hero);

        // The slow lookup wasn't tied to this build: it runs on and fills the cache for the next one.
        await _youTube.Received(1).GetAsync(slow, _user, CancellationToken.None);
        pending.SetResult("lateTrailer");
    }

    private HeroService Create() => new(_library, _reader, _trailers, _youTube, _time);
}
