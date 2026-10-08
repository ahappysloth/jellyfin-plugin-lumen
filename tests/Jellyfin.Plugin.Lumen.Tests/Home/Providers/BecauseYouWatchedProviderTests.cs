using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Configuration;
using MediaBrowser.Model.Dto;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class BecauseYouWatchedProviderTests
{
    private readonly ISimilarItemsManager _similar = Substitute.For<ISimilarItemsManager>();
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly IUserDataManager _userData = Substitute.For<IUserDataManager>();
    private readonly User _user = TestData.User();

    public BecauseYouWatchedProviderTests()
    {
        _userData.GetUserDataBatch(Arg.Any<IReadOnlyList<BaseItem>>(), _user).Returns(new Dictionary<Guid, UserItemData>());
        _similar.GetMovieRecommendationsAsync(default, default, default, default, default!, default)
            .ReturnsForAnyArgs(Task.FromResult<IReadOnlyList<SimilarItemsRecommendation>>([]));
    }

    [Theory]
    [InlineData(RecommendationType.SimilarToRecentlyPlayed, "Because you watched Alpha")]
    [InlineData(RecommendationType.SimilarToLikedItem, "Because you watched Alpha")]
    [InlineData(RecommendationType.HasDirectorFromRecentlyPlayed, "Directed by Alpha")]
    [InlineData(RecommendationType.HasLikedActor, "Starring Alpha")]
    public void TitlesFollowRecommendationType(RecommendationType type, string expected)
    {
        Assert.Equal(expected, BecauseYouWatchedProvider.TitleFor(Rec("Alpha", type)));
    }

    [Fact]
    public async Task InterleavesMovieAndSeriesRows_UpToMaxRows_AndDropsPlayed()
    {
        var played = TestData.Movie("played");
        var fresh = TestData.Movie("fresh");
        _similar.GetMovieRecommendationsAsync(default, default, default, default, default!, default).ReturnsForAnyArgs(
            Task.FromResult<IReadOnlyList<SimilarItemsRecommendation>>(
            [
                Rec("M1", RecommendationType.SimilarToRecentlyPlayed, played, fresh),
                Rec("M2", RecommendationType.SimilarToRecentlyPlayed, TestData.Movie("x")),
            ]));
        _userData.GetUserDataBatch(Arg.Any<IReadOnlyList<BaseItem>>(), _user).Returns(new Dictionary<Guid, UserItemData> { [played.Id] = TestData.UserData(played: true) });
        var show = TestData.Series("Show One");
        _library.GetItemById<Series>(show.Id, _user).Returns(show);
        _library.GetLibraryOptions(show).Returns(new LibraryOptions());
        _similar.GetSimilarItemsAsync(show, Arg.Any<IReadOnlyList<Guid>>(), _user, Arg.Any<DtoOptions>(), Arg.Any<int?>(), Arg.Any<LibraryOptions?>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<BaseItem>>([TestData.Series("Similar Show")]));
        var history = new WatchHistory([new WatchedEntry(TestData.Episode(show, 1, 1), show.Id, show.Name, [], TestData.Now.UtcDateTime)]);
        var def = TestData.Section(SectionTypes.BecauseYouWatched, ("maxRows", "3"));

        var rows = await Create().GetRowsAsync(TestData.Context(_user, history), def, CancellationToken.None);

        Assert.Equal(["Because you watched M1", "Because you watched Show One", "Because you watched M2"], rows.Select(r => r.Title));
        Assert.Equal([fresh], rows[0].Items);
        Assert.Equal(3, rows.Select(r => r.Id).Distinct().Count());
    }

    [Fact]
    public async Task SkipsSeedsTheUserCanNoLongerSee()
    {
        var show = TestData.Series("Hidden");
        _library.GetItemById<Series>(show.Id, _user).Returns((Series?)null);
        var history = new WatchHistory([new WatchedEntry(TestData.Episode(show, 1, 1), show.Id, show.Name, [], TestData.Now.UtcDateTime)]);

        var rows = await Create().GetRowsAsync(TestData.Context(_user, history), TestData.Section(SectionTypes.BecauseYouWatched), CancellationToken.None);

        Assert.Empty(rows);
    }

    [Fact]
    public void Interleave_AlternatesAndAppendsRemainder()
    {
        Assert.Equal([1, 10, 2, 3], BecauseYouWatchedProvider.Interleave([1, 2, 3], [10]));
    }

    private static SimilarItemsRecommendation Rec(string name, RecommendationType type, params BaseItem[] items) => new()
    {
        BaselineItemName = name,
        CategoryId = Guid.NewGuid(),
        RecommendationType = type,
        Items = items,
    };

    private BecauseYouWatchedProvider Create() => new(_similar, _library, _userData);
}
