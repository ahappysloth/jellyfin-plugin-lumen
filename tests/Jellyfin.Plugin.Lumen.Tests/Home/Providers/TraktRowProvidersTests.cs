using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using Jellyfin.Plugin.Lumen.Requests;
using Jellyfin.Plugin.Lumen.Trakt;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class TraktRowProvidersTests
{
    private const int SeerrUserId = 7;
    private const string ListUrl = "https://trakt.tv/users/sean/lists/best-of";
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/"), "k");

    private readonly ITraktLists _lists = Substitute.For<ITraktLists>();
    private readonly ISeerrUserMap _users = Substitute.For<ISeerrUserMap>();
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly List<InternalItemsQuery> _queries = [];
    private readonly User _user = TestData.User();
    private BaseItem[] _owned = [];

    public TraktRowProvidersTests()
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
    }

    public static TheoryData<string, string, string> Types => new()
    {
        { SectionTypes.TraktBoxOffice, "movies/boxoffice", "Box Office This Weekend" },
        { SectionTypes.TraktAnticipatedMovies, "movies/anticipated", "Most Anticipated Movies" },
        { SectionTypes.TraktAnticipatedShows, "shows/anticipated", "Most Anticipated Shows" },
        { SectionTypes.TraktTrendingMovies, "movies/trending", "Trending Movies" },
        { SectionTypes.TraktTrendingShows, "shows/trending", "Trending Shows" },
    };

    [Theory]
    [MemberData(nameof(Types))]
    public async Task EachType_ShowsItsTraktList_InOrder_OwnedAndRequestable(string type, string path, string title)
    {
        var kind = path.StartsWith("movies", StringComparison.Ordinal) ? TraktListKind.Movies : TraktListKind.Shows;
        BaseItem owned = kind == TraktListKind.Movies ? TestData.Movie("Owned") : TestData.Series("Owned");
        owned.SetProviderId(MetadataProvider.Tmdb, "2");
        _owned = [owned];
        TraktQuery? asked = null;
        _lists.GetAsync(Arg.Do<TraktQuery>(q => asked = q), Arg.Any<CancellationToken>())
            .Returns(new TraktList([new("One", 2026, 1, null, kind), new("Two", 2026, 2, null, kind), new("Three", 2026, 3, null, kind)]));

        var row = Assert.Single(await Rows(type));

        Assert.Equal(path, asked!.Path);
        Assert.Equal((title, type), (row.Title, row.Type));
        var prefix = kind == TraktListKind.Movies ? "movie" : "tv";
        Assert.Equal($"{prefix}-1", row.Entries![0].Catalog!.Key);
        Assert.Same(owned, row.Entries[1].Item);
        Assert.Equal($"{prefix}-3", row.Entries[2].Catalog!.Key);
        Assert.Equal([kind == TraktListKind.Movies ? BaseItemKind.Movie : BaseItemKind.Series], Assert.Single(_queries).IncludeItemTypes);
    }

    [Theory]
    [MemberData(nameof(Types))]
    public async Task WithoutAKey_EachTypeIsHidden(string type, string path, string title)
    {
        _ = (path, title);
        _lists.GetAsync(default!, default).ReturnsForAnyArgs((TraktList?)null);

        Assert.Empty(await Rows(type));
        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Theory]
    [MemberData(nameof(Types))]
    public void EachType_IsNamed_HasNoParameters_AndTheCatalogRowsTimeout(string type, string path, string title)
    {
        _ = (path, title);
        var provider = Provider(type);

        Assert.False(string.IsNullOrWhiteSpace(provider.DisplayName));
        Assert.Contains("Trakt", provider.Description, StringComparison.Ordinal);
        Assert.Empty(provider.Parameters);
        Assert.Equal(CatalogSectionProvider.RowTimeout, provider.Timeout);
    }

    [Theory]
    [InlineData(SectionTypes.TraktBoxOffice)]
    [InlineData(SectionTypes.TraktTrendingMovies)]
    public async Task WithoutSeerr_OnlyOwnedTitles(string type)
    {
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);
        var owned = TestData.Movie("Owned");
        owned.SetProviderId(MetadataProvider.Tmdb, "2");
        _owned = [owned];
        _lists.GetAsync(default!, default).ReturnsForAnyArgs(new TraktList([new("One", 2026, 1, null), new("Two", 2026, 2, null)]));

        var row = Assert.Single(await Rows(type));

        Assert.Same(owned, Assert.Single(row.Entries!).Item);
        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Theory]
    [InlineData(SectionTypes.TraktAnticipatedMovies)]
    [InlineData(SectionTypes.TraktAnticipatedShows)]
    public async Task MostAnticipated_IsHiddenWithoutSeerr_EvenWithAnOwnedTitle_AndTraktIsntAsked(string type)
    {
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);
        var owned = TestData.Movie("Owned");
        owned.SetProviderId(MetadataProvider.Tmdb, "1");
        _owned = [owned];
        _lists.GetAsync(default!, default).ReturnsForAnyArgs(new TraktList([new("One", 2026, 1, null)]));

        Assert.Empty(await Rows(type));
        Assert.Empty(_lists.ReceivedCalls());
    }

    [Fact]
    public async Task TheBoxOffice_IsTenAtMost()
    {
        _lists.GetAsync(TraktQuery.BoxOffice, Arg.Any<CancellationToken>())
            .Returns(new TraktList(Enumerable.Range(1, 12).Select(i => new TraktTitle("T" + i, 2026, i, null)).ToList()));

        Assert.True(Assert.Single(await Rows(SectionTypes.TraktBoxOffice)).Entries!.Count <= 10);
    }

    [Fact]
    public async Task Trending_FillsToTheHomesItemLimit()
    {
        _lists.GetAsync(TraktQuery.Trending(TraktListKind.Movies), Arg.Any<CancellationToken>())
            .Returns(new TraktList(Enumerable.Range(1, 40).Select(i => new TraktTitle("T" + i, 2026, i, null)).ToList()));

        Assert.Equal(20, Assert.Single(await Rows(SectionTypes.TraktTrendingMovies)).Entries!.Count);
    }

    [Fact]
    public void TheList_HasOneParameter_ItsRequiredTextAddress()
    {
        var parameter = Assert.Single(Provider(SectionTypes.TraktList).Parameters);

        Assert.Equal((TraktListProvider.UrlParam, SectionParameterKind.Text, true), (parameter.Name, parameter.Kind, parameter.Required));
    }

    [Theory]
    [InlineData("https://trakt.tv/users/sean/lists/best-of", true)]
    [InlineData("https://trakt.tv/lists/123", true)]
    [InlineData("https://trakt.tv/users/sean/watchlist", false)]
    [InlineData("https://letterboxd.com/sean/list/best-of/", false)]
    [InlineData("best of", false)]
    public void TheListsAddress_IsCheckedOnSave_WithAClearError(string url, bool valid)
    {
        var provider = Provider(SectionTypes.TraktList);
        var errors = new ConfigValidator([provider]).Validate(new PluginConfiguration
        {
            Sections = [TestData.Section(SectionTypes.TraktList, (TraktListProvider.UrlParam, url))],
        });

        if (valid)
        {
            Assert.Empty(errors);
        }
        else
        {
            Assert.Equal(
                "Section 1 (TraktList): Enter a public Trakt list's address, like https://trakt.tv/users/name/lists/list-name.",
                Assert.Single(errors));
        }
    }

    [Fact]
    public void TheListsAddress_IsRequired()
    {
        var errors = new ConfigValidator([Provider(SectionTypes.TraktList)]).Validate(new PluginConfiguration
        {
            Sections = [TestData.Section(SectionTypes.TraktList)],
        });

        Assert.Contains(errors, e => e.Contains("is required", StringComparison.Ordinal));
    }

    [Fact]
    public async Task TheList_IsTitledWithItsName_AndMixesMoviesAndShows_MatchingEachByItsType()
    {
        Assert.True(TraktListRef.TryParse(ListUrl, out var list));

        // TMDB ids are per type: movie 5 and show 5 are different titles.
        var movie = TestData.Movie("Movie five");
        movie.SetProviderId(MetadataProvider.Tmdb, "5");
        _owned = [movie];
        _lists.GetAsync(TraktQuery.ListItems(list), Arg.Any<CancellationToken>()).Returns(new TraktList(
            [new("Show five", 2020, 5, null, TraktListKind.Shows), new("Movie five", 2021, 5, null, TraktListKind.Movies)],
            "Sean's best"));

        var row = Assert.Single(await Rows(SectionTypes.TraktList, (TraktListProvider.UrlParam, ListUrl)));

        Assert.Equal("Sean's best", row.Title);
        Assert.Equal("tv-5", row.Entries![0].Catalog!.Key);
        Assert.Same(movie, row.Entries[1].Item);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Series], Assert.Single(_queries).IncludeItemTypes);
        await _seerr.Received(1).GetTitleSummaryAsync(Endpoint, SeerrUserId, "tv", 5, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task TheList_KeepsTheAdminsTitle_OrSaysTraktListWhenTheListHasNoName()
    {
        _lists.GetAsync(default!, default).ReturnsForAnyArgs(new TraktList([new("One", 2026, 1, null)]));
        var definition = TestData.Section(SectionTypes.TraktList, (TraktListProvider.UrlParam, ListUrl));

        Assert.Equal("Trakt list", Assert.Single(await Provider(SectionTypes.TraktList).GetRowsAsync(TestData.Context(_user), definition, CancellationToken.None)).Title);

        definition.Title = "Weekend picks";
        Assert.Equal("Weekend picks", Assert.Single(await Provider(SectionTypes.TraktList).GetRowsAsync(TestData.Context(_user), definition, CancellationToken.None)).Title);
    }

    [Fact]
    public async Task APrivateOrMissingList_IsHidden()
    {
        _lists.GetAsync(default!, default).ReturnsForAnyArgs((TraktList?)null);

        Assert.Empty(await Rows(SectionTypes.TraktList, (TraktListProvider.UrlParam, ListUrl)));
    }

    [Fact]
    public async Task AnInvalidAddress_ShowsNothing_WithoutAskingTrakt()
    {
        Assert.Empty(await Rows(SectionTypes.TraktList, (TraktListProvider.UrlParam, "not a list")));
        Assert.Empty(_lists.ReceivedCalls());
    }

    private Task<IReadOnlyList<HomeRow>> Rows(string type, params (string Name, string Value)[] parameters) =>
        Provider(type).GetRowsAsync(TestData.Context(_user), TestData.Section(type, parameters), CancellationToken.None);

    private IHomeSectionProvider Provider(string type)
    {
        var access = new CatalogRowAccess(_users);
        var cards = new TraktCards(_seerr, new CatalogMapper(_library), _library, TimeProvider.System, NullLogger<TraktCards>.Instance);
        return type switch
        {
            SectionTypes.TraktBoxOffice => new TraktBoxOfficeProvider(_lists, access, cards, TimeProvider.System),
            SectionTypes.TraktAnticipatedMovies => new TraktAnticipatedMoviesProvider(_lists, access, cards, TimeProvider.System),
            SectionTypes.TraktAnticipatedShows => new TraktAnticipatedShowsProvider(_lists, access, cards, TimeProvider.System),
            SectionTypes.TraktTrendingMovies => new TraktTrendingMoviesProvider(_lists, access, cards, TimeProvider.System),
            SectionTypes.TraktTrendingShows => new TraktTrendingShowsProvider(_lists, access, cards, TimeProvider.System),
            _ => new TraktListProvider(_lists, access, cards, TimeProvider.System),
        };
    }
}
