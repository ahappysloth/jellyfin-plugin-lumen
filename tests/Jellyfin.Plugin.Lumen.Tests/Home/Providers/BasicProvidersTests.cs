using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.TV;
using MediaBrowser.Model.Querying;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class BasicProvidersTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly User _user = TestData.User();
    private readonly List<InternalItemsQuery> _queries = [];

    public BasicProvidersTests()
    {
        _library.GetItemList(Arg.Do<InternalItemsQuery>(_queries.Add)).Returns(Array.Empty<BaseItem>());
    }

    [Fact]
    public async Task ContinueWatching_QueriesResumableMoviesAndEpisodes()
    {
        var movie = TestData.Movie("m");
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(new BaseItem[] { movie });
        var def = TestData.Section(SectionTypes.ContinueWatching);

        var rows = await new ContinueWatchingProvider(_library).GetRowsAsync(TestData.Context(_user), def, CancellationToken.None);

        var row = Assert.Single(rows);
        Assert.Equal("Continue Watching", row.Title);
        Assert.Same(movie, Assert.Single(row.Items));
        var q = Assert.Single(_queries);
        Assert.Same(_user, q.User);
        Assert.True(q.IsResumable);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Episode], q.IncludeItemTypes);
        Assert.Equal([MediaType.Video], q.MediaTypes);
        Assert.Equal((ItemSortBy.DatePlayed, SortOrder.Descending), Assert.Single(q.OrderBy));
        Assert.Equal(20, q.Limit);
        Assert.False(q.IsVirtualItem);
    }

    [Fact]
    public async Task ContinueWatching_Empty_ReturnsNoRows_AndHonorsTitleOverride()
    {
        var def = TestData.Section(SectionTypes.ContinueWatching);
        def.Title = "Pick up where you left off";

        Assert.Empty(await new ContinueWatchingProvider(_library).GetRowsAsync(TestData.Context(_user), def, CancellationToken.None));
    }

    [Fact]
    public async Task NextUp_UsesSeriesManager_WithoutResumables()
    {
        var tv = Substitute.For<ITVSeriesManager>();
        NextUpQuery? captured = null;
        var episode = TestData.Episode(TestData.Series("s"), 1, 2);
        tv.GetNextUp(Arg.Do<NextUpQuery>(q => captured = q), Arg.Any<DtoOptions>()).Returns(new QueryResult<BaseItem>([episode]));

        var rows = await new NextUpProvider(tv).GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.NextUp), CancellationToken.None);

        Assert.Equal("Next Up", Assert.Single(rows).Title);
        Assert.Same(_user, captured!.User);
        Assert.Equal(20, captured.Limit);
        Assert.False(captured.EnableResumable);
    }

    [Fact]
    public void CardIds_CollapsesEpisodesToSeries_InFirstSeenOrder()
    {
        var show = TestData.Series("Show");
        var movie = TestData.Movie("Movie");
        var orphan = TestData.Episode(show, 1, 1);
        orphan.SeriesId = Guid.Empty;
        BaseItem[] items = [TestData.Episode(show, 1, 3), movie, TestData.Episode(show, 1, 2), orphan];

        Assert.Equal([show.Id, movie.Id], RecentlyAddedProvider.CardIds(items));
    }

    [Fact]
    public async Task RecentlyAdded_ScansLight_ThenLoadsOnlyTheShownCardsInFull_InNewestFirstOrder()
    {
        var show = TestData.Series("Show");
        var movie = TestData.Movie("Movie");
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(ci => ci.Arg<InternalItemsQuery>() switch
        {
            { ItemIds.Length: > 0 } => new BaseItem[] { movie, show }, // the database's order, not the row's
            _ => new BaseItem[] { TestData.Episode(show, 1, 3), movie, TestData.Episode(show, 1, 2) },
        });

        var rows = await new RecentlyAddedProvider(_library).GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.RecentlyAdded), CancellationToken.None);

        Assert.Equal([show, movie], Assert.Single(rows).Items);
        Assert.Equal(2, _queries.Count);
        var scan = _queries[0];
        Assert.Same(_user, scan.User);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Episode], scan.IncludeItemTypes);
        Assert.Equal(100, scan.Limit);
        Assert.False(scan.DtoOptions.EnableImages);
        Assert.False(scan.DtoOptions.EnableUserData);
        Assert.Empty(scan.DtoOptions.Fields);
        var load = _queries[1];
        Assert.Same(_user, load.User);
        Assert.Equal([show.Id, movie.Id], load.ItemIds);
        Assert.True(load.DtoOptions.EnableImages);
        Assert.True(load.DtoOptions.EnableUserData);
        Assert.Contains(ItemFields.Genres, load.DtoOptions.Fields);
    }

    [Fact]
    public async Task RecentlyAdded_SkipsCardsTheUserCannotSee_AndFillsFromTheNextNewest()
    {
        var hidden = TestData.Series("Hidden");
        var a = TestData.Movie("A");
        var b = TestData.Movie("B");
        var c = TestData.Movie("C");
        var d = TestData.Movie("D");
        BaseItem[] visible = [a, b, c, d];
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(ci => ci.Arg<InternalItemsQuery>() switch
        {
            { ItemIds.Length: > 0 } q => visible.Where(v => q.ItemIds.Contains(v.Id)).ToArray(),
            _ => new BaseItem[] { a, TestData.Episode(hidden, 1, 1), b, c, d },
        });
        var context = new HomeContext(_user, TestData.Now, () => Task.FromResult(WatchHistory.Empty)) { ItemLimit = 2 };

        var rows = await new RecentlyAddedProvider(_library).GetRowsAsync(context, TestData.Section(SectionTypes.RecentlyAdded), CancellationToken.None);

        Assert.Equal([a, b], Assert.Single(rows).Items);
        Assert.Equal(10, _queries[0].Limit);
        Assert.Equal([a.Id, hidden.Id], _queries[1].ItemIds);
        Assert.Equal([b.Id, c.Id, d.Id], _queries[2].ItemIds); // one more query for the rest, not one per gap
        Assert.Equal(3, _queries.Count);
    }

    [Fact]
    public async Task RecentlyAdded_ScopesToVisibleLibrary()
    {
        var libraryId = Guid.NewGuid();
        _library.GetItemById<Folder>(libraryId, _user).Returns(new Folder { Id = libraryId });
        var def = TestData.Section(SectionTypes.RecentlyAdded, ("libraryId", libraryId.ToString("N")));

        await new RecentlyAddedProvider(_library).GetRowsAsync(TestData.Context(_user), def, CancellationToken.None);

        var q = Assert.Single(_queries);
        Assert.Equal(libraryId, q.ParentId);
        Assert.True(q.Recursive);
        Assert.Equal((ItemSortBy.DateCreated, SortOrder.Descending), Assert.Single(q.OrderBy));
    }

    [Fact]
    public async Task RecentlyAdded_ReturnsNothing_WhenUserCannotSeeLibrary()
    {
        var libraryId = Guid.NewGuid();
        _library.GetItemById<Folder>(libraryId, _user).Returns((Folder?)null);
        var def = TestData.Section(SectionTypes.RecentlyAdded, ("libraryId", libraryId.ToString("N")));

        var rows = await new RecentlyAddedProvider(_library).GetRowsAsync(TestData.Context(_user), def, CancellationToken.None);

        Assert.Empty(rows);
        Assert.Empty(_queries);
    }

    [Fact]
    public async Task RecentlyAdded_WithoutLibrary_SpansUserLibraries()
    {
        await new RecentlyAddedProvider(_library).GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.RecentlyAdded), CancellationToken.None);

        Assert.Equal(Guid.Empty, Assert.Single(_queries).ParentId);
    }
}
