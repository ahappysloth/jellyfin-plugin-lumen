using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class WatchHistoryServiceTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly IUserDataManager _userData = Substitute.For<IUserDataManager>();
    private readonly User _user = TestData.User();

    [Fact]
    public async Task ReturnsRecentPlays_WithSeriesGenresForEpisodes()
    {
        var show = TestData.Series("Show", "Sci-Fi");
        var episode = TestData.Episode(show, 1, 1);
        var recentMovie = TestData.Movie("Recent", "Drama");
        var oldMovie = TestData.Movie("Old", "Western");
        var neverPlayed = TestData.Movie("Never", "Comedy");
        var queries = new List<InternalItemsQuery>();
        _library.GetItemList(Arg.Do<InternalItemsQuery>(queries.Add)).Returns(ci =>
            ci.Arg<InternalItemsQuery>().ItemIds.Length > 0
                ? new BaseItem[] { show }
                : new BaseItem[] { episode, recentMovie, oldMovie, neverPlayed });
        _userData.GetUserDataBatch(Arg.Any<IReadOnlyList<BaseItem>>(), _user).Returns(new Dictionary<Guid, UserItemData>
        {
            [episode.Id] = TestData.UserData(lastPlayed: TestData.Now.UtcDateTime.AddDays(-1)),
            [recentMovie.Id] = TestData.UserData(played: true, lastPlayed: TestData.Now.UtcDateTime.AddDays(-2)),
            [oldMovie.Id] = TestData.UserData(played: true, lastPlayed: TestData.Now.UtcDateTime.AddDays(-120)),
        });

        var history = await new WatchHistoryService(_library, _userData).GetAsync(_user, TestData.Now, CancellationToken.None);

        Assert.Equal([episode.Id, recentMovie.Id], history.Entries.Select(e => e.Item.Id));
        Assert.Equal(show.Id, history.Entries[0].SeriesId);
        Assert.Equal(["Sci-Fi"], history.Entries[0].Genres);
        Assert.Equal(["Drama"], history.Entries[1].Genres);
        var main = queries[0];
        Assert.Same(_user, main.User);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Episode], main.IncludeItemTypes);
        Assert.Equal((ItemSortBy.DatePlayed, SortOrder.Descending), Assert.Single(main.OrderBy));
        Assert.Equal(200, main.Limit);
    }

    [Fact]
    public async Task EmptyLibrary_ReturnsEmptyHistory()
    {
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(Array.Empty<BaseItem>());

        var history = await new WatchHistoryService(_library, _userData).GetAsync(_user, TestData.Now, CancellationToken.None);

        Assert.Empty(history.Entries);
        _userData.DidNotReceiveWithAnyArgs().GetUserDataBatch(default!, default!);
    }
}
