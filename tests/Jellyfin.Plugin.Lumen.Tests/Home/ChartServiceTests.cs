using System.Security.Claims;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using Jellyfin.Plugin.Lumen.Requests;
using Jellyfin.Plugin.Lumen.Trakt;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class ChartServiceTests
{
    private const int SeerrUserId = 7;
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/"), "k");

    private readonly ITraktLists _lists = Substitute.For<ITraktLists>();
    private readonly ISeerrUserMap _users = Substitute.For<ISeerrUserMap>();
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly User _user = TestData.User();
    private BaseItem[] _owned = [];

    public ChartServiceTests()
    {
        _lists.Enabled.Returns(true);
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, SeerrUserId, Endpoint));
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(_ => _owned);
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(c => new SeerrTitle
        {
            Id = c.ArgAt<int>(3),
            Title = "Seerr " + c.ArgAt<int>(3),
            Name = "Seerr " + c.ArgAt<int>(3),
        });
    }

    [Theory]
    [InlineData(TraktPeriod.Weekly, "movies/watched/weekly")]
    [InlineData(TraktPeriod.Monthly, "movies/watched/monthly")]
    [InlineData(TraktPeriod.Yearly, "movies/watched/yearly")]
    [InlineData(TraktPeriod.All, "movies/watched/all")]
    public async Task EachPeriod_IsItsOwnChart_OfAHundred(TraktPeriod period, string path)
    {
        TraktQuery? asked = null;
        _lists.GetAsync(Arg.Do<TraktQuery>(q => asked = q), Arg.Any<CancellationToken>()).Returns(Chart(3));

        var page = await Service().GetPageAsync(_user, TraktListKind.Movies, period, 0, 24, CancellationToken.None);

        Assert.Equal((path, 100), (asked!.Path, asked.Limit));
        Assert.Equal([1, 2, 3], page!.Entries.Select(e => e.Rank));
    }

    [Fact]
    public async Task WithSeerr_OwnedTitlesAreItems_AndTheRestCatalogCards_RankedAsOnTrakt()
    {
        var owned = TestData.Movie("Two");
        owned.SetProviderId(MetadataProvider.Tmdb, "2");
        _owned = [owned];
        _lists.GetAsync(default!, default).ReturnsForAnyArgs(Chart(3));

        var page = (await Service().GetPageAsync(_user, TraktListKind.Movies, TraktPeriod.Weekly, 0, 24, CancellationToken.None))!;

        Assert.Equal(3, page.TotalCount);
        Assert.Equal("movie-1", page.Entries[0].Catalog!.Key);
        Assert.Same(owned, page.Entries[1].Item);
        Assert.Equal("movie-3", page.Entries[2].Catalog!.Key);
    }

    [Fact]
    public async Task WithoutSeerr_OnlyOwnedTitles_KeepingTheirTrueRanks()
    {
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);
        var fourth = TestData.Movie("Four");
        fourth.SetProviderId(MetadataProvider.Tmdb, "4");
        var ninth = TestData.Movie("Nine");
        ninth.SetProviderId(MetadataProvider.Imdb, "tt0000009");
        _owned = [ninth, fourth];
        _lists.GetAsync(default!, default).ReturnsForAnyArgs(new TraktList(Enumerable.Range(1, 10)
            .Select(i => new TraktTitle("T" + i, 2026, i == 9 ? null : i, i == 9 ? "tt0000009" : null))
            .ToList()));

        var page = (await Service().GetPageAsync(_user, TraktListKind.Movies, TraktPeriod.Weekly, 0, 24, CancellationToken.None))!;

        Assert.Equal([(4, fourth), (9, ninth)], page.Entries.Select(e => (e.Rank, e.Item!)));
        Assert.Equal(2, page.TotalCount);
        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Fact]
    public async Task Pages_LookUpOnlyTheirOwnTitles()
    {
        _lists.GetAsync(default!, default).ReturnsForAnyArgs(Chart(100, TraktListKind.Shows));

        var second = (await Service().GetPageAsync(_user, TraktListKind.Shows, TraktPeriod.Yearly, 24, 24, CancellationToken.None))!;

        Assert.Equal(Enumerable.Range(25, 24), second.Entries.Select(e => e.Rank));
        Assert.Equal((100, 24), (second.TotalCount, second.StartIndex));
        Assert.Equal("tv-25", second.Entries[0].Catalog!.Key);
        Assert.Equal(24, _seerr.ReceivedCalls().Count());

        var last = (await Service().GetPageAsync(_user, TraktListKind.Shows, TraktPeriod.Yearly, 96, 24, CancellationToken.None))!;
        Assert.Equal([97, 98, 99, 100], last.Entries.Select(e => e.Rank));
    }

    [Fact]
    public async Task APageIsFiftyAtMost_AndNeverPastTheHundred()
    {
        _lists.GetAsync(default!, default).ReturnsForAnyArgs(Chart(120));

        var page = (await Service().GetPageAsync(_user, TraktListKind.Movies, TraktPeriod.All, -5, 500, CancellationToken.None))!;

        Assert.Equal((ChartService.MaxPageSize, 0, 100), (page.Entries.Count, page.StartIndex, page.TotalCount));
    }

    [Fact]
    public async Task ATitleSeerrCantDescribe_LeavesAGap_NotAShift()
    {
        _lists.GetAsync(default!, default).ReturnsForAnyArgs(Chart(3));
        _seerr.GetTitleSummaryAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<int>(), "movie", 2, Arg.Any<CancellationToken>())
            .ThrowsAsync(new SeerrException("404", System.Net.HttpStatusCode.NotFound));

        var page = (await Service().GetPageAsync(_user, TraktListKind.Movies, TraktPeriod.Weekly, 0, 24, CancellationToken.None))!;

        Assert.Equal([1, 3], page.Entries.Select(e => e.Rank));

        // Seerr doesn't know the title: asking again wouldn't bring it, so the page isn't short of it.
        Assert.Equal(0, page.Missing);
    }

    [Fact]
    public async Task APageSaysHowManyTitlesSeerrFailedOn_SoThePageCanOfferToTryAgain()
    {
        _lists.GetAsync(default!, default).ReturnsForAnyArgs(Chart(5));
        _seerr.GetTitleSummaryAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<int>(), "movie", 2, Arg.Any<CancellationToken>())
            .ThrowsAsync(new SeerrException("502", System.Net.HttpStatusCode.BadGateway));
        _seerr.GetTitleSummaryAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<int>(), "movie", 4, Arg.Any<CancellationToken>())
            .ThrowsAsync(new SeerrException("Seerr is down.") { IsCircuitOpen = true });

        // Never answers: left out once the page's time for Seerr is up.
        _seerr.GetTitleSummaryAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<int>(), "movie", 5, Arg.Any<CancellationToken>())
            .Returns(new TaskCompletionSource<SeerrTitle>().Task);
        var time = new FakeTimeProvider(TestData.Now);

        var pending = Service(time).GetPageAsync(_user, TraktListKind.Movies, TraktPeriod.Weekly, 0, 24, CancellationToken.None);
        time.Advance(ChartService.DetailsBudget);
        var page = (await pending)!;

        Assert.Equal([1, 3], page.Entries.Select(e => e.Rank));
        Assert.Equal(3, page.Missing);
        Assert.Equal(5, page.TotalCount);
    }

    [Fact]
    public async Task TwoTitlesThatAreOneItem_ShowOnce_AtTheBetterRank()
    {
        // Title 2 is the item by its TMDB id, title 4 by its IMDb id; title 3 is another item, which Seerr says is here.
        var both = TestData.Movie("Both");
        both.SetProviderId(MetadataProvider.Tmdb, "2");
        both.SetProviderId(MetadataProvider.Imdb, "tt0000004");
        _owned = [both];
        var hereId = Guid.NewGuid();
        var here = TestData.Movie("Here");
        _library.GetItemById<BaseItem>(hereId, _user).Returns(here);
        _seerr.GetTitleSummaryAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<int>(), "movie", Arg.Is<int>(id => id == 3 || id == 5), Arg.Any<CancellationToken>())
            .Returns(c => new SeerrTitle { Id = c.ArgAt<int>(3), Title = "T", MediaInfo = new SeerrMediaInfo { Status = 5, JellyfinMediaId = hereId.ToString("N") } });
        _lists.GetAsync(default!, default).ReturnsForAnyArgs(new TraktList(
        [
            new TraktTitle("T1", 2026, 1, null),
            new TraktTitle("T2", 2026, 2, null),
            new TraktTitle("T3", 2026, 3, null),
            new TraktTitle("T4", 2026, 444, "tt0000004"),
            new TraktTitle("T5", 2026, 5, null),
        ]));

        var page = (await Service().GetPageAsync(_user, TraktListKind.Movies, TraktPeriod.Weekly, 0, 24, CancellationToken.None))!;

        Assert.Equal([(1, (BaseItem?)null), (2, both), (3, here)], page.Entries.Select(e => (e.Rank, e.Item)));
        Assert.Equal(4, page.TotalCount);
    }

    [Fact]
    public async Task NoChart_WhenTraktHasNothingToGive()
    {
        _lists.GetAsync(default!, default).ReturnsForAnyArgs((TraktList?)null);

        Assert.Null(await Service().GetPageAsync(_user, TraktListKind.Movies, TraktPeriod.Weekly, 0, 24, CancellationToken.None));
    }

    [Fact]
    public async Task Controller_NoPageWithoutAKey_OrWithLumenOff()
    {
        _lists.Enabled.Returns(false);
        Assert.IsType<NotFoundResult>((await Controller(new PluginConfiguration()).GetChart("movies", "weekly")).Result);

        _lists.Enabled.Returns(true);
        Assert.IsType<NotFoundResult>((await Controller(new PluginConfiguration { Enabled = false }).GetChart("movies", "weekly")).Result);
    }

    [Theory]
    [InlineData("people", "weekly")]
    [InlineData("movies", "daily")]
    [InlineData("movies", "")]
    public async Task Controller_RefusesOtherCharts(string type, string period)
    {
        Assert.IsType<BadRequestObjectResult>((await Controller(new PluginConfiguration()).GetChart(type, period)).Result);
    }

    [Fact]
    public async Task Controller_SaysWhenTraktIsntAnswering()
    {
        _lists.GetAsync(default!, default).ReturnsForAnyArgs((TraktList?)null);

        var result = Assert.IsType<ObjectResult>((await Controller(new PluginConfiguration()).GetChart("shows", "all")).Result);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, result.StatusCode);
    }

    [Fact]
    public async Task Controller_MapsItemsAsHomeCards_InRankOrder()
    {
        var owned = TestData.Movie("Two");
        owned.SetProviderId(MetadataProvider.Tmdb, "2");
        _owned = [owned];
        _lists.GetAsync(default!, default).ReturnsForAnyArgs(Chart(3));
        var mapper = Substitute.For<IHomeDtoMapper>();
        mapper.MapCards(Arg.Any<IReadOnlyList<BaseItem>>(), _user)
            .Returns(c => c.ArgAt<IReadOnlyList<BaseItem>>(0).Select(i => new BaseItemDto { Id = i.Id, Name = i.Name }).ToList());

        var page = (await Controller(new PluginConfiguration(), mapper).GetChart("Movies", "Weekly", 0, 24)).Value!;

        Assert.Equal([1, 2, 3], page.Entries.Select(e => e.Rank));
        Assert.Equal("movie-1", page.Entries[0].Catalog!.Key);
        Assert.Equal("Two", page.Entries[1].Item!.Name);
        Assert.Null(page.Entries[1].Catalog);
    }

    private static TraktList Chart(int count, TraktListKind kind = TraktListKind.Movies) =>
        new(Enumerable.Range(1, count).Select(i => new TraktTitle("T" + i, 2026, i, null, kind)).ToList());

    private ChartService Service(TimeProvider? time = null)
    {
        time ??= TimeProvider.System;
        var cards = new TraktCards(_seerr, new CatalogMapper(_library), _library, time, NullLogger<TraktCards>.Instance);
        return new ChartService(_lists, new CatalogRowAccess(_users), cards, time);
    }

    private ChartsController Controller(PluginConfiguration config, IHomeDtoMapper? mapper = null)
    {
        var reader = Substitute.For<ILumenConfigReader>();
        reader.Current.Returns(config);
        var users = Substitute.For<IUserManager>();
        users.GetUserById(_user.Id).Returns(_user);
        if (mapper is null)
        {
            mapper = Substitute.For<IHomeDtoMapper>();
            mapper.MapCards(default!, default!).ReturnsForAnyArgs([]);
        }

        return new ChartsController(Service(), mapper, users, reader, NullLogger<ChartsController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("Jellyfin-UserId", _user.Id.ToString())], "test")),
                },
            },
        };
    }
}
