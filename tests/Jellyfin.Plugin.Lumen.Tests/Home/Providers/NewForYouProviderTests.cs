using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class NewForYouProviderTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly User _user = TestData.User();
    private readonly List<InternalItemsQuery> _queries = [];

    [Fact]
    public async Task CombinesNewEpisodesOfWatchedShows_AndNewMoviesInTopGenres_NewestFirst()
    {
        var watchedShow = TestData.Series("Watched", "Sci-Fi");
        var otherShow = TestData.Series("Other", "Sci-Fi");
        var newEpisode = TestData.Episode(watchedShow, 2, 1);
        newEpisode.DateCreated = TestData.Now.UtcDateTime.AddDays(-1);
        var otherEpisode = TestData.Episode(otherShow, 1, 1);
        var newMovie = TestData.Movie("New Movie", "Sci-Fi");
        newMovie.DateCreated = TestData.Now.UtcDateTime.AddDays(-3);
        var history = new WatchHistory([new WatchedEntry(TestData.Episode(watchedShow, 1, 1), watchedShow.Id, "Watched", ["Sci-Fi"], TestData.Now.UtcDateTime)]);
        _library.GetItemList(Arg.Do<InternalItemsQuery>(_queries.Add)).Returns(ci =>
        {
            var q = ci.Arg<InternalItemsQuery>();
            if (q.ItemIds.Length > 0)
            {
                return new BaseItem[] { watchedShow };
            }

            return q.IncludeItemTypes.Contains(BaseItemKind.Episode) ? new BaseItem[] { newEpisode, otherEpisode } : new BaseItem[] { newMovie };
        });
        var def = TestData.Section(SectionTypes.NewForYou, ("days", "7"));

        var rows = await new NewForYouProvider(_library).GetRowsAsync(TestData.Context(_user, history), def, CancellationToken.None);

        Assert.Equal([watchedShow, newMovie], Assert.Single(rows).Items);
        var movieQuery = _queries.Single(q => q.IncludeItemTypes.Contains(BaseItemKind.Movie));
        Assert.Equal(["Sci-Fi"], movieQuery.Genres);
        Assert.Equal(TestData.Now.UtcDateTime.AddDays(-7), movieQuery.MinDateCreated);
        Assert.False(movieQuery.IsPlayed);
    }

    [Fact]
    public async Task NoHistory_RunsNoQueries()
    {
        var rows = await new NewForYouProvider(_library).GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.NewForYou), CancellationToken.None);

        Assert.Empty(rows);
        _library.DidNotReceiveWithAnyArgs().GetItemList(default!);
    }

    [Fact]
    public void Merge_OrdersNewestFirst_Deduplicates_AndLimits()
    {
        var a = TestData.Movie("a");
        var b = TestData.Movie("b");
        var c = TestData.Movie("c");

        var merged = NewForYouProvider.Merge([(a, TestData.Now.UtcDateTime.AddDays(-3)), (b, TestData.Now.UtcDateTime), (a, TestData.Now.UtcDateTime.AddDays(-1)), (c, TestData.Now.UtcDateTime.AddDays(-9))], 2);

        Assert.Equal([b, a], merged);
    }
}
