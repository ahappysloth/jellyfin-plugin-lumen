using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using Jellyfin.Plugin.Lumen.Requests;
using Jellyfin.Plugin.Lumen.Trakt;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class Top10ProvidersTests
{
    private const int SeerrUserId = 7;
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/"), "k");

    private readonly ITraktLists _lists = Substitute.For<ITraktLists>();
    private readonly ISeerrUserMap _users = Substitute.For<ISeerrUserMap>();
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly List<InternalItemsQuery> _queries = [];
    private readonly User _user = TestData.User();
    private BaseItem[] _owned = [];

    public Top10ProvidersTests()
    {
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, SeerrUserId, Endpoint));
        _library.GetItemList(Arg.Do<InternalItemsQuery>(_queries.Add)).Returns(_ => _owned);
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(c => new SeerrTitle
        {
            Id = c.ArgAt<int>(3),
            Title = "Seerr " + c.ArgAt<int>(3),
            Name = "Seerr " + c.ArgAt<int>(3),
            PosterPath = "/p.jpg",
        });
        _seerr.DiscoverPageAsync(default!, default, default, default, default).ReturnsForAnyArgs(new SeerrPage { Page = 1, TotalPages = 1, Results = [] });
    }

    [Fact]
    public void Providers_AreNamed_HaveNoParameters_AndTheCatalogRowsTimeout()
    {
        var movies = Provider(SectionTypes.Top10Movies);
        var shows = Provider(SectionTypes.Top10Shows);

        Assert.Equal(("Top 10 Movies", "Top 10 Shows"), (movies.DisplayName, shows.DisplayName));
        Assert.Empty(movies.Parameters);
        Assert.Equal(CatalogSectionProvider.RowTimeout, movies.Timeout);
        Assert.True(TraktClient.Timeout < CatalogSectionProvider.RowTimeout);
    }

    [Fact]
    public async Task NoTrakt_AndNoSeerr_NoRow()
    {
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        Assert.Empty(await Rows(SectionTypes.Top10Movies));
        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Fact]
    public async Task Trakt_OwnedTitlesAreLibraryItems_MatchedByTmdbThenImdb_InTraktsOrder()
    {
        var inception = Movie("Inception", tmdb: "27205");
        var byImdb = Movie("Only IMDb", imdb: "tt0000002");
        _owned = [byImdb, inception];
        Trakt(TraktListKind.Movies, new("Inception", 2010, 27205, "tt1375666"), new("Unowned", 2026, 500, null), new("Only IMDb", 2024, 999, "tt0000002"));

        var row = Assert.Single(await Rows(SectionTypes.Top10Movies));

        Assert.Equal("Top 10 Movies This Week", row.Title);
        Assert.Equal(SectionTypes.Top10Movies, row.Type);
        Assert.Same(inception, row.Entries![0].Item);
        Assert.Equal(("movie-500", "Seerr 500", "p.jpg"), (row.Entries[1].Catalog!.Key, row.Entries[1].Catalog!.Title, row.Entries[1].Catalog!.Poster));
        Assert.Same(byImdb, row.Entries[2].Item);

        // One query, as the viewing user (their library access and parental controls), for the list's ids.
        var query = Assert.Single(_queries);
        Assert.Same(_user, query.User);
        Assert.Equal([BaseItemKind.Movie], query.IncludeItemTypes);
        Assert.Equal(["27205", "500", "999"], query.HasAnyProviderIds!["Tmdb"]);
        Assert.Equal(["tt1375666", "tt0000002"], query.HasAnyProviderIds["Imdb"]);
        await _seerr.Received(1).GetTitleSummaryAsync(Endpoint, SeerrUserId, "movie", 500, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Trakt_Shows_QuerySeriesAndSeerrTv()
    {
        var series = TestData.Series("Severance");
        series.SetProviderId(MetadataProvider.Tmdb, "95396");
        _owned = [series];
        Trakt(TraktListKind.Shows, new("Severance", 2022, 95396, null), new("Other", 2025, 1399, null));

        var row = Assert.Single(await Rows(SectionTypes.Top10Shows));

        Assert.Equal("Top 10 Shows This Week", row.Title);
        Assert.Equal([BaseItemKind.Series], Assert.Single(_queries).IncludeItemTypes);
        Assert.Same(series, row.Entries![0].Item);
        Assert.Equal("tv-1399", row.Entries[1].Catalog!.Key);
    }

    [Fact]
    public async Task Trakt_WithoutSeerr_ShowsOnlyOwnedTitles()
    {
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);
        var second = Movie("Second", tmdb: "2");
        var fourth = Movie("Fourth", tmdb: "4");
        _owned = [fourth, second];
        Trakt(TraktListKind.Movies, Enumerable.Range(1, 5).Select(i => new TraktTitle("T" + i, 2026, i, null)).ToArray());

        var row = Assert.Single(await Rows(SectionTypes.Top10Movies));

        Assert.Equal([second, fourth], row.Entries!.Select(e => e.Item));
        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Fact]
    public async Task Trakt_WithoutSeerr_AndNothingOwned_NoRow()
    {
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);
        Trakt(TraktListKind.Movies, new TraktTitle("T", 2026, 1, null));

        Assert.Empty(await Rows(SectionTypes.Top10Movies));
    }

    [Fact]
    public async Task Trakt_TitlesWithoutATmdbId_NeedToBeOwned()
    {
        Trakt(TraktListKind.Movies, new TraktTitle("No ids", 2026, null, "tt0000009"), new TraktTitle("Has one", 2026, 3, null));

        var row = Assert.Single(await Rows(SectionTypes.Top10Movies));

        Assert.Equal("movie-3", Assert.Single(row.Entries!).Catalog!.Key);
    }

    [Fact]
    public async Task Trakt_FillsTen_SkippingTitlesSeerrCantDescribe()
    {
        Trakt(TraktListKind.Movies, Enumerable.Range(1, 40).Select(i => new TraktTitle("T" + i, 2026, i, null)).ToArray());
        _seerr.GetTitleSummaryAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<int>(), "movie", 2, Arg.Any<CancellationToken>())
            .ThrowsAsync(new SeerrException("404", System.Net.HttpStatusCode.NotFound));

        var row = Assert.Single(await Rows(SectionTypes.Top10Movies));

        Assert.Equal(["movie-1", "movie-3", "movie-4", "movie-5", "movie-6", "movie-7", "movie-8", "movie-9", "movie-10", "movie-11"], row.Entries!.Select(e => e.Catalog!.Key));
        Assert.True(_seerr.ReceivedCalls().Count() <= Top10Provider.Size + 4);
    }

    [Fact]
    public async Task Trakt_SeerrDown_StillShowsOwnedTitlesFromFurtherDown()
    {
        // Trakt's top 15 aren't here and Seerr can't describe any of them; #16 and #22 are owned.
        var sixteenth = Movie("Sixteenth", tmdb: "16");
        var twentySecond = Movie("Twenty-second", tmdb: "22");
        _owned = [twentySecond, sixteenth];
        Trakt(TraktListKind.Movies, Enumerable.Range(1, 40).Select(i => new TraktTitle("T" + i, 2026, i, null)).ToArray());
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default)
            .ReturnsForAnyArgs<SeerrTitle>(_ => throw new SeerrException("down", System.Net.HttpStatusCode.ServiceUnavailable));

        var row = Assert.Single(await Rows(SectionTypes.Top10Movies));

        Assert.Equal([sixteenth, twentySecond], row.Entries!.Select(e => e.Item));
    }

    [Fact]
    public async Task Trakt_ATitleSeerrKnowsIsHere_IsTheLibraryItem_Once()
    {
        var movie = Movie("No provider ids");
        var id = Guid.NewGuid();
        _library.GetItemById<BaseItem>(id, _user).Returns(movie);
        _seerr.GetTitleSummaryAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<int>(), "movie", Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(c => new SeerrTitle { Id = c.ArgAt<int>(3), Title = "T", MediaInfo = new SeerrMediaInfo { Status = 5, JellyfinMediaId = id.ToString("N") } });
        Trakt(TraktListKind.Movies, new TraktTitle("A", 2026, 1, null), new TraktTitle("A again", 2026, 2, null));

        var row = Assert.Single(await Rows(SectionTypes.Top10Movies));

        Assert.Same(movie, Assert.Single(row.Entries!).Item);
    }

    [Fact]
    public async Task Trakt_ATitleOnTheServerButHiddenFromTheUser_IsACatalogCard_LikeTheCatalogRows()
    {
        // The library query (as the user) doesn't return it, and Seerr's Jellyfin id isn't visible to them either.
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default)
            .ReturnsForAnyArgs(c => new SeerrTitle { Id = 1, Title = "Grown-ups only", MediaInfo = new SeerrMediaInfo { Status = 5, JellyfinMediaId = Guid.NewGuid().ToString("N") } });
        Trakt(TraktListKind.Movies, new TraktTitle("Grown-ups only", 2026, 1, null));

        var card = Assert.Single(Assert.Single(await Rows(SectionTypes.Top10Movies)).Entries!).Catalog!;

        Assert.Equal(("Available", null), (card.State, card.JellyfinItemId));
    }

    [Fact]
    public async Task NoTrakt_FallsBackToSeerrTrending_OfTheRowsType_AcrossTwoPages()
    {
        _seerr.DiscoverPageAsync(Endpoint, SeerrUserId, SeerrDiscoverList.Trending, 1, Arg.Any<CancellationToken>()).Returns(new SeerrPage
        {
            Page = 1,
            TotalPages = 5,
            Results = [Media("movie", 1), Media("tv", 2), new SeerrMedia { MediaType = "person", Id = 3 }, Media("movie", 4)],
        });
        _seerr.DiscoverPageAsync(Endpoint, SeerrUserId, SeerrDiscoverList.Trending, 2, Arg.Any<CancellationToken>()).Returns(new SeerrPage
        {
            Page = 2,
            TotalPages = 5,
            Results = [Media("movie", 4), Media("movie", 5)],
        });

        var row = Assert.Single(await Rows(SectionTypes.Top10Movies));

        Assert.Equal(["movie-1", "movie-4", "movie-5"], row.Entries!.Select(e => e.Catalog!.Key));
        await _seerr.DidNotReceive().DiscoverPageAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<int>(), Arg.Any<SeerrDiscoverList>(), 3, Arg.Any<CancellationToken>());
        Assert.Empty(_queries);
    }

    [Fact]
    public async Task NoTrakt_TrendingStopsAtTen_AndAtItsLastPage()
    {
        _seerr.DiscoverPageAsync(Endpoint, SeerrUserId, SeerrDiscoverList.Trending, 1, Arg.Any<CancellationToken>()).Returns(new SeerrPage
        {
            Page = 1,
            TotalPages = 1,
            Results = Enumerable.Range(1, 14).Select(i => Media("tv", i)).ToList(),
        });

        var row = Assert.Single(await Rows(SectionTypes.Top10Shows));

        Assert.Equal(Top10Provider.Size, row.Entries!.Count);
        await _seerr.DidNotReceive().DiscoverPageAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<int>(), Arg.Any<SeerrDiscoverList>(), 2, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AnEmptyTraktList_AlsoFallsBack()
    {
        Trakt(TraktListKind.Movies);
        _seerr.DiscoverPageAsync(default!, default, default, default, default).ReturnsForAnyArgs(new SeerrPage { Page = 1, TotalPages = 1, Results = [Media("movie", 8)] });

        Assert.Equal("movie-8", Assert.Single(Assert.Single(await Rows(SectionTypes.Top10Movies)).Entries!).Catalog!.Key);
    }

    [Fact]
    public async Task NoTrakt_AndSeerrFails_NoRow()
    {
        _seerr.DiscoverPageAsync(default!, default, default, default, default).ThrowsAsyncForAnyArgs(new SeerrException("down"));

        Assert.Empty(await Rows(SectionTypes.Top10Movies));
    }

    [Fact]
    public async Task AShorterItemLimit_AndACustomTitle_AreKept()
    {
        Trakt(TraktListKind.Movies, Enumerable.Range(1, 20).Select(i => new TraktTitle("T" + i, 2026, i, null)).ToArray());
        var definition = TestData.Section(SectionTypes.Top10Movies);
        definition.Title = "Hot right now";

        var row = Assert.Single(await Provider(SectionTypes.Top10Movies).GetRowsAsync(
            new HomeContext(_user, TestData.Now, () => Task.FromResult(WatchHistory.Empty)) { ItemLimit = 5 }, definition, CancellationToken.None));

        Assert.Equal("Hot right now", row.Title);
        Assert.Equal(5, row.Entries!.Count);
    }

    private static Movie Movie(string name, string? tmdb = null, string? imdb = null)
    {
        var movie = TestData.Movie(name);
        if (tmdb is not null)
        {
            movie.SetProviderId(MetadataProvider.Tmdb, tmdb);
        }

        if (imdb is not null)
        {
            movie.SetProviderId(MetadataProvider.Imdb, imdb);
        }

        return movie;
    }

    private static SeerrMedia Media(string type, int id) => new() { MediaType = type, Id = id, Title = "T" + id, Name = "T" + id };

    private void Trakt(TraktListKind kind, params TraktTitle[] titles) =>
        _lists.GetAsync(TraktQuery.Watched(kind, TraktPeriod.Weekly), Arg.Any<CancellationToken>())
            .Returns(new TraktList(titles.Select(t => t with { Kind = kind }).ToList()));

    private Task<IReadOnlyList<HomeRow>> Rows(string type) =>
        Provider(type).GetRowsAsync(TestData.Context(_user), TestData.Section(type), CancellationToken.None);

    private IHomeSectionProvider Provider(string type)
    {
        var mapper = new CatalogMapper(_library);
        var access = new CatalogRowAccess(_users);
        var cards = new TraktCards(_seerr, mapper, _library, TimeProvider.System, NullLogger<TraktCards>.Instance);
        return type == SectionTypes.Top10Movies
            ? new Top10MoviesProvider(_lists, access, cards, _seerr, mapper, TimeProvider.System, NullLogger<Top10MoviesProvider>.Instance)
            : new Top10ShowsProvider(_lists, access, cards, _seerr, mapper, TimeProvider.System, NullLogger<Top10ShowsProvider>.Instance);
    }
}
