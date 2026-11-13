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
    private const string ImdbUrl = "https://imdb-video.media-imdb.com/vi1/v_720p.mp4?Expires=1&Signature=s";
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly ILinkedItemsReader _reader = Substitute.For<ILinkedItemsReader>();
    private readonly ITrailerLookup _trailers = Substitute.For<ITrailerLookup>();
    private readonly IOnlineTrailers _online = Substitute.For<IOnlineTrailers>();
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
    public async Task OnlineTrailers_Off_AreNotLookedUp()
    {
        var movie = TestData.Movie("m").WithImages(ImageType.Backdrop);
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(new BaseItem[] { movie });
        _online.GetAsync(default(BaseItem)!, default!, default).ReturnsForAnyArgs(new OnlineTrailer(ImdbUrl, null));

        var off = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration(), CancellationToken.None);
        var noPreviews = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { YouTubeTrailers = true, TrailerPreview = false }, CancellationToken.None);

        Assert.Equal(new HeroItem(movie, null), Assert.Single(off));
        Assert.Equal(new HeroItem(movie, null), Assert.Single(noPreviews));
        Assert.Empty(_online.ReceivedCalls());
    }

    [Fact]
    public async Task OnlineTrailers_On_FillInForSlidesWithoutALocalTrailer_WhichAlwaysWins()
    {
        var local = TestData.Movie("local").WithImages(ImageType.Backdrop);
        var imdb = TestData.Movie("imdb").WithImages(ImageType.Backdrop);
        var youTube = TestData.Movie("youtube").WithImages(ImageType.Backdrop);
        var none = TestData.Movie("none").WithImages(ImageType.Backdrop);
        var trailerId = Guid.NewGuid();
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(new BaseItem[] { local, imdb, youTube, none });
        _trailers.GetLocalTrailerId(local, _user).Returns(trailerId);
        _online.GetAsync(local, _user, Arg.Any<CancellationToken>()).Returns(new OnlineTrailer(ImdbUrl, null));
        _online.GetAsync(imdb, _user, Arg.Any<CancellationToken>()).Returns(new OnlineTrailer(ImdbUrl, null));
        _online.GetAsync(youTube, _user, Arg.Any<CancellationToken>()).Returns(new OnlineTrailer(null, "dQw4w9WgXcQ"));
        _online.GetAsync(none, _user, Arg.Any<CancellationToken>()).Returns(OnlineTrailer.None);

        var hero = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { YouTubeTrailers = true }, CancellationToken.None);

        Assert.Equal(
            [new HeroItem(local, trailerId), new HeroItem(imdb, null, null, ImdbUrl), new HeroItem(youTube, null, "dQw4w9WgXcQ"), new HeroItem(none, null)],
            hero);
        await _online.DidNotReceive().GetAsync(local, Arg.Any<User>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ASlide_GetsIMDbs1080pFileWithIts720p()
    {
        const string Hd = "https://imdb-video.media-imdb.com/vi1/a_1080p.mp4";
        var movie = TestData.Movie("m").WithImages(ImageType.Backdrop);
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(new BaseItem[] { movie });
        _online.GetAsync(movie, _user, Arg.Any<CancellationToken>()).Returns(new OnlineTrailer(ImdbUrl, "dQw4w9WgXcQ", Hd));

        var hero = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { YouTubeTrailers = true }, CancellationToken.None);

        Assert.Equal(new HeroItem(movie, null, null, ImdbUrl, Hd), Assert.Single(hero));
    }

    [Fact]
    public async Task ASlide_GetsIMDbsTrailer_NotBoth()
    {
        var movie = TestData.Movie("m").WithImages(ImageType.Backdrop);
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(new BaseItem[] { movie });
        _online.GetAsync(movie, _user, Arg.Any<CancellationToken>()).Returns(new OnlineTrailer(ImdbUrl, "dQw4w9WgXcQ"));

        var hero = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { YouTubeTrailers = true }, CancellationToken.None);

        Assert.Equal(new HeroItem(movie, null, null, ImdbUrl), Assert.Single(hero));
    }

    [Fact]
    public async Task OnlineLookup_ThatFailsOrOutlastsItsBudget_CostsOnlyThatSlideItsTrailer()
    {
        var slow = TestData.Movie("slow").WithImages(ImageType.Backdrop);
        var broken = TestData.Movie("broken").WithImages(ImageType.Backdrop);
        var quick = TestData.Movie("quick").WithImages(ImageType.Backdrop);
        var pending = new TaskCompletionSource<OnlineTrailer>();
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(new BaseItem[] { slow, broken, quick });
        _online.GetAsync(slow, _user, Arg.Any<CancellationToken>()).Returns(pending.Task);
        _online.GetAsync(broken, _user, Arg.Any<CancellationToken>()).ThrowsAsync(new InvalidOperationException("boom"));
        _online.GetAsync(quick, _user, Arg.Any<CancellationToken>()).Returns(new OnlineTrailer(ImdbUrl, null));
        using var cancelled = new CancellationTokenSource();

        var build = Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { YouTubeTrailers = true }, cancelled.Token);
        Assert.False(build.IsCompleted);
        _time.Advance(HeroService.OnlineBudget);
        var hero = await build;

        Assert.Equal([new HeroItem(slow, null), new HeroItem(broken, null), new HeroItem(quick, null, null, ImdbUrl)], hero);

        // The slow lookup wasn't tied to this build: it runs on and fills the cache for the next one.
        await _online.Received(1).GetAsync(slow, _user, CancellationToken.None);
        pending.SetResult(new OnlineTrailer(null, "lateTrailer"));
    }

    private HeroService Create() => new(_library, _reader, _trailers, _online, _time);
}
