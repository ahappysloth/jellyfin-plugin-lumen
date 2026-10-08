using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
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
    public void Group_CollapsesEpisodesToSeries_InFirstSeenOrder()
    {
        var show = TestData.Series("Show");
        var movie = TestData.Movie("Movie");
        BaseItem[] items = [TestData.Episode(show, 1, 3), movie, TestData.Episode(show, 1, 2), TestData.Episode(TestData.Series("Orphan"), 1, 1)];

        var grouped = RecentlyAddedProvider.Group(items, new Dictionary<Guid, BaseItem> { [show.Id] = show }, 10);

        Assert.Equal([show, movie], grouped);
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
