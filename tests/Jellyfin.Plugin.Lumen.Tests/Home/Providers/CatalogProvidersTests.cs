using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class CatalogProvidersTests
{
    private const int SeerrUserId = 7;
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/"), "k");
    private static readonly string[] Types =
    [
        SectionTypes.CatalogTrending, SectionTypes.CatalogPopularMovies, SectionTypes.CatalogPopularShows, SectionTypes.CatalogUpcoming, SectionTypes.MyRequests,
    ];

    private readonly ISeerrUserMap _users = Substitute.For<ISeerrUserMap>();
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly ILumenConfigStore _config = Substitute.For<ILumenConfigStore>();
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly User _user = TestData.User();

    public CatalogProvidersTests()
    {
        _config.Current.Returns(new PluginConfiguration { RequestsEnabled = true, SeerrUrl = "http://seerr:5055", SeerrApiKey = "k" });
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, SeerrUserId, Endpoint));
        _seerr.DiscoverAsync(default!, default, default, default).ReturnsForAnyArgs(Page());
    }

    public static IEnumerable<object[]> AllTypes() => Types.Select(t => new object[] { t });

    [Theory]
    [MemberData(nameof(AllTypes))]
    public async Task NoAccess_NoRows_AndNoSeerrCalls(string type)
    {
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        Assert.Empty(await Rows(type));
        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Theory]
    [MemberData(nameof(AllTypes))]
    public async Task EnabledWithoutSeerrUser_NoRows(string type)
    {
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, null));

        Assert.Empty(await Rows(type));
    }

    [Theory]
    [MemberData(nameof(AllTypes))]
    public async Task SeerrFailure_NoRows(string type)
    {
        _seerr.DiscoverAsync(default!, default, default, default).ThrowsAsyncForAnyArgs(new SeerrException("down"));
        _seerr.GetUserRequestsAsync(default!, default, default).ThrowsAsyncForAnyArgs(new SeerrException("down"));

        Assert.Empty(await Rows(type));
    }

    [Theory]
    [MemberData(nameof(AllTypes))]
    public async Task EmptyList_NoRows(string type)
    {
        _seerr.GetUserRequestsAsync(default!, default, default).ReturnsForAnyArgs([]);

        Assert.Empty(await Rows(type));
    }

    [Fact]
    public void Providers_HaveTheirNames_NoParameters_AndALongerTimeout()
    {
        var providers = Types.Select(Provider).ToList();

        Assert.Equal(["Trending", "Popular Movies", "Popular Shows", "Coming Soon", "My Requests"], providers.Select(p => p.DisplayName));
        Assert.All(providers, p => Assert.Empty(p.Parameters));
        Assert.All(providers, p => Assert.True(p.Timeout > SeerrClient.Timeout));
    }

    [Fact]
    public async Task Trending_MixesLibraryItemsAndCatalogTitles_InSeerrsOrder_DroppingPeople()
    {
        var owned = Guid.NewGuid();
        var hidden = Guid.NewGuid();
        var movie = TestData.Movie("The Matrix");
        _library.GetItemById<BaseItem>(owned, _user).Returns(movie);
        _library.GetItemById<BaseItem>(hidden, _user).Returns((BaseItem?)null);
        _seerr.DiscoverAsync(Arg.Any<SeerrEndpoint>(), SeerrUserId, SeerrDiscoverList.Trending, Arg.Any<CancellationToken>()).Returns(Page(
            Media("movie", 1, mediaInfo: new SeerrMediaInfo { Status = 5, JellyfinMediaId = owned.ToString("N") }),
            new SeerrMedia { MediaType = "person", Id = 2, Name = "Someone" },
            Media("tv", 3),
            Media("movie", 4, mediaInfo: new SeerrMediaInfo { Status = 5, JellyfinMediaId = hidden.ToString("N") })));
        var definition = TestData.Section(SectionTypes.CatalogTrending);

        var row = Assert.Single(await Provider(SectionTypes.CatalogTrending).GetRowsAsync(TestData.Context(_user), definition, CancellationToken.None));

        Assert.Equal("Trending", row.Title);
        Assert.Equal(HomeRow.RowId(definition, 0), row.Id);
        Assert.Empty(row.Items);
        Assert.Equal(3, row.Entries!.Count);
        Assert.Same(movie, row.Entries[0].Item);
        Assert.Null(row.Entries[0].Catalog);
        Assert.Equal("tv-3", row.Entries[1].Catalog!.Key);
        Assert.Null(row.Entries[1].Item);
        Assert.Equal(("movie-4", "Available", null), (row.Entries[2].Catalog!.Key, row.Entries[2].Catalog!.State, row.Entries[2].Catalog!.JellyfinItemId));
    }

    [Fact]
    public async Task CustomTitle_IsUsed()
    {
        _seerr.DiscoverAsync(default!, default, default, default).ReturnsForAnyArgs(Page(Media("movie", 1)));
        var definition = TestData.Section(SectionTypes.CatalogPopularMovies);
        definition.Title = "Big films";

        var row = Assert.Single(await Provider(SectionTypes.CatalogPopularMovies).GetRowsAsync(TestData.Context(_user), definition, CancellationToken.None));

        Assert.Equal("Big films", row.Title);
    }

    [Theory]
    [InlineData(SectionTypes.CatalogPopularMovies, SeerrDiscoverList.PopularMovies, "movie")]
    [InlineData(SectionTypes.CatalogPopularShows, SeerrDiscoverList.PopularTv, "tv")]
    public async Task PopularLists_UseTheirList_AndAssumeItsMediaType(string type, SeerrDiscoverList list, string mediaType)
    {
        _seerr.DiscoverAsync(Arg.Any<SeerrEndpoint>(), SeerrUserId, list, Arg.Any<CancellationToken>())
            .Returns(Page(new SeerrMedia { Id = 9, Title = "T", Name = "T" }));

        var row = Assert.Single(await Rows(type));

        Assert.Equal(mediaType + "-9", Assert.Single(row.Entries!).Catalog!.Key);
    }

    [Theory]
    [MemberData(nameof(AllTypes))]
    public async Task Rows_AreLimitedToTheItemLimit(string type)
    {
        var many = Enumerable.Range(1, 30).Select(i => Media("movie", i, releaseDate: "2027-01-01")).ToArray();
        _seerr.DiscoverAsync(default!, default, default, default).ReturnsForAnyArgs(Page(many));
        _seerr.GetUserRequestsAsync(default!, default, default).ReturnsForAnyArgs(
            Enumerable.Range(1, 30).Select(i => Request(i, "movie", i)).ToList());
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default)
            .ReturnsForAnyArgs(c => new SeerrTitle { Id = c.ArgAt<int>(3), Title = "T" });

        var row = Assert.Single(await Rows(type, itemLimit: 20));

        Assert.Equal(20, row.Entries!.Count);
    }

    [Fact]
    public async Task Upcoming_MergesMoviesAndShows_SoonestFirst_UndatedLast()
    {
        _seerr.DiscoverAsync(Arg.Any<SeerrEndpoint>(), SeerrUserId, SeerrDiscoverList.UpcomingMovies, Arg.Any<CancellationToken>()).Returns(Page(
            Media("movie", 1, releaseDate: "2026-12-20"),
            Media("movie", 2, releaseDate: string.Empty),
            Media("movie", 3, releaseDate: "2026-11-10")));
        _seerr.DiscoverAsync(Arg.Any<SeerrEndpoint>(), SeerrUserId, SeerrDiscoverList.UpcomingTv, Arg.Any<CancellationToken>()).Returns(Page(
            new SeerrMedia { Id = 4, Name = "S", FirstAirDate = "2026-12-01", ReleaseDate = "2020-01-01" },
            new SeerrMedia { Id = 5, Name = "S2" }));

        var row = Assert.Single(await Rows(SectionTypes.CatalogUpcoming));

        Assert.Equal(["movie-3", "tv-4", "movie-1", "movie-2", "tv-5"], row.Entries!.Select(e => e.Catalog!.Key));
    }

    [Fact]
    public async Task MyRequests_NewestFirst_SkipsDeclined_AndDeduplicates()
    {
        _seerr.GetUserRequestsAsync(Arg.Any<SeerrEndpoint>(), SeerrUserId, Arg.Any<CancellationToken>()).Returns(
        [
            Request(1, "movie", 603, status: 2, mediaStatus: 3, created: TestData.Now.AddDays(-3)),
            Request(2, "tv", 1399, status: 1, mediaStatus: 2, created: TestData.Now.AddDays(-1)),
            Request(3, "movie", 604, status: 3, mediaStatus: 2, created: TestData.Now),
            Request(4, "tv", 1399, status: 2, mediaStatus: 4, created: TestData.Now.AddDays(-2)),
            Request(5, "movie", 1399, status: 2, mediaStatus: 2, created: TestData.Now.AddDays(-4)),
        ]);
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(c => new SeerrTitle
        {
            Id = c.ArgAt<int>(3),
            Title = "Movie " + c.ArgAt<int>(3),
            Name = "Show " + c.ArgAt<int>(3),
            ReleaseDate = "1999-03-30",
            FirstAirDate = "2011-04-17",
            PosterPath = "/p.jpg",
            BackdropPath = "/b.jpg",
            VoteAverage = 8.25,
            Genres = [new SeerrGenre { Id = 28, Name = "Action" }],
            MediaInfo = new SeerrMediaInfo { Status = 5 },
        });

        var row = Assert.Single(await Rows(SectionTypes.MyRequests));

        Assert.Equal("My Requests", row.Title);
        var cards = row.Entries!.Select(e => e.Catalog!).ToList();
        Assert.Equal(["tv-1399", "movie-603", "movie-1399"], cards.Select(c => c.Key));

        // State from the request's media, not the (possibly stale) details; everything else from the details.
        Assert.Equal(["Requested", "Downloading", "Requested"], cards.Select(c => c.State));
        Assert.Equal(("Show 1399", 2011, "p.jpg", "b.jpg", 8.3), (cards[0].Title, cards[0].Year, cards[0].Poster, cards[0].Backdrop, cards[0].Rating));
        Assert.Equal(["Action"], cards[0].GenreNames);
        Assert.Equal(("Movie 603", 1999), (cards[1].Title, cards[1].Year));
        await _seerr.DidNotReceive().GetTitleSummaryAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<int>(), "movie", 604, Arg.Any<CancellationToken>());
        await _seerr.Received(1).GetTitleSummaryAsync(Arg.Any<SeerrEndpoint>(), SeerrUserId, "tv", 1399, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task MyRequests_AvailableTitle_BecomesTheLibraryItem()
    {
        var owned = Guid.NewGuid();
        var series = TestData.Series("Lumen Saga");
        _library.GetItemById<BaseItem>(owned, _user).Returns(series);
        _seerr.GetUserRequestsAsync(default!, default, default).ReturnsForAnyArgs(
            [Request(1, "tv", 1399, mediaStatus: 5, jellyfinMediaId: owned.ToString("N")), Request(2, "movie", 603)]);
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(c => new SeerrTitle { Id = c.ArgAt<int>(3), Title = "T", Name = "T" });

        var row = Assert.Single(await Rows(SectionTypes.MyRequests));

        Assert.Same(series, row.Entries![0].Item);
        Assert.Equal("movie-603", row.Entries[1].Catalog!.Key);
    }

    [Fact]
    public async Task MyRequests_SkipsTitlesWhoseDetailsFail()
    {
        _seerr.GetUserRequestsAsync(default!, default, default).ReturnsForAnyArgs([Request(1, "movie", 603), Request(2, "movie", 604)]);
        _seerr.GetTitleSummaryAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<int>(), "movie", 603, Arg.Any<CancellationToken>())
            .ThrowsAsync(new SeerrException("404", System.Net.HttpStatusCode.NotFound));
        _seerr.GetTitleSummaryAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<int>(), "movie", 604, Arg.Any<CancellationToken>())
            .Returns(new SeerrTitle { Id = 604, Title = "Reloaded" });

        var row = Assert.Single(await Rows(SectionTypes.MyRequests));

        Assert.Equal("movie-604", Assert.Single(row.Entries!).Catalog!.Key);
    }

    [Fact]
    public async Task MyRequests_FetchesDetailsAFewAtATime()
    {
        _seerr.GetUserRequestsAsync(default!, default, default).ReturnsForAnyArgs(Enumerable.Range(1, 20).Select(i => Request(i, "movie", i)).ToList());
        var running = 0;
        var peak = 0;
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(async c =>
        {
            var now = Interlocked.Increment(ref running);
            InterlockedMax(ref peak, now);
            await Task.Delay(10);
            Interlocked.Decrement(ref running);
            return new SeerrTitle { Id = c.ArgAt<int>(3), Title = "T" };
        });

        var row = Assert.Single(await Rows(SectionTypes.MyRequests));

        Assert.Equal(20, row.Entries!.Count);
        Assert.InRange(peak, 1, MyRequestsProvider.MaxConcurrentDetails);
    }

    private static void InterlockedMax(ref int target, int value)
    {
        int current;
        while ((current = Volatile.Read(ref target)) < value && Interlocked.CompareExchange(ref target, value, current) != current)
        {
        }
    }

    private static SeerrPage Page(params SeerrMedia[] results) => new() { Page = 1, TotalPages = 1, Results = results };

    private static SeerrMedia Media(string type, int id, string? releaseDate = null, SeerrMediaInfo? mediaInfo = null) =>
        new() { MediaType = type, Id = id, Title = "T" + id, Name = "T" + id, ReleaseDate = releaseDate, FirstAirDate = releaseDate, MediaInfo = mediaInfo };

    private static SeerrUserRequest Request(
        int id, string type, int tmdbId, int status = 2, int mediaStatus = 2, DateTimeOffset? created = null, string? jellyfinMediaId = null) => new()
    {
        Id = id,
        Status = status,
        Type = type,
        CreatedAt = created ?? TestData.Now.AddMinutes(-id),
        Media = new SeerrRequestMedia { TmdbId = tmdbId, MediaType = type, Status = mediaStatus, JellyfinMediaId = jellyfinMediaId },
    };

    private Task<IReadOnlyList<HomeRow>> Rows(string type, int itemLimit = 20) =>
        Provider(type).GetRowsAsync(new HomeContext(_user, TestData.Now, () => Task.FromResult(WatchHistory.Empty)) { ItemLimit = itemLimit }, TestData.Section(type), CancellationToken.None);

    private IHomeSectionProvider Provider(string type)
    {
        var mapper = new CatalogMapper(_library);
        var access = new CatalogRowAccess(_users);
        return type switch
        {
            SectionTypes.CatalogTrending => new CatalogTrendingProvider(access, _seerr, mapper, NullLogger<CatalogTrendingProvider>.Instance),
            SectionTypes.CatalogPopularMovies => new CatalogPopularMoviesProvider(access, _seerr, mapper, NullLogger<CatalogPopularMoviesProvider>.Instance),
            SectionTypes.CatalogPopularShows => new CatalogPopularShowsProvider(access, _seerr, mapper, NullLogger<CatalogPopularShowsProvider>.Instance),
            SectionTypes.CatalogUpcoming => new CatalogUpcomingProvider(access, _seerr, mapper, NullLogger<CatalogUpcomingProvider>.Instance),
            SectionTypes.MyRequests => new MyRequestsProvider(access, _seerr, mapper, NullLogger<MyRequestsProvider>.Instance),
            _ => throw new ArgumentOutOfRangeException(nameof(type)),
        };
    }
}
