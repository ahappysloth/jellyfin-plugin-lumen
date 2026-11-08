using System.Globalization;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class BadgeServiceTests
{
    private static readonly DateTime Old = TestData.Now.UtcDateTime.AddDays(-30);
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly User _user = TestData.User();
    private readonly List<InternalItemsQuery> _queries = [];

    [Theory]
    [InlineData(0, true)]
    [InlineData(-7, true)]
    [InlineData(-8, false)]
    public void Movie_AddedWithinWindow_IsRecentlyAdded(int days, bool expected)
    {
        var movie = TestData.Movie("m");
        movie.DateCreated = TestData.Now.UtcDateTime.AddDays(days);

        var badges = Badges(movie);

        Assert.Equal(expected ? CardBadges.RecentlyAdded : null, badges.GetValueOrDefault(Key(movie)));
    }

    [Fact]
    public void WindowEdge_IsInclusive()
    {
        var atEdge = TestData.Movie("edge");
        atEdge.DateCreated = TestData.Now.UtcDateTime - BadgeService.Window;
        var justOutside = TestData.Movie("outside");
        justOutside.DateCreated = TestData.Now.UtcDateTime - BadgeService.Window - TimeSpan.FromSeconds(1);

        var badges = Badges(atEdge, justOutside);

        Assert.Equal(CardBadges.RecentlyAdded, badges[Key(atEdge)]);
        Assert.False(badges.ContainsKey(Key(justOutside)));
    }

    [Fact]
    public void Episode_AddedWithinWindow_IsRecentlyAdded_OldEpisodeIsNot()
    {
        var series = Series(created: Old);
        var fresh = TestData.Episode(series, 1, 2);
        var stale = TestData.Episode(series, 1, 1);
        stale.DateCreated = Old;

        var badges = Badges(fresh, stale);

        Assert.Equal(CardBadges.RecentlyAdded, badges[Key(fresh)]);
        Assert.False(badges.ContainsKey(Key(stale)));
    }

    [Fact]
    public void NewSeries_IsRecentlyAdded_WithoutAnEpisodeLookup()
    {
        var series = Series(created: TestData.Now.UtcDateTime.AddDays(-2), lastMediaAdded: TestData.Now.UtcDateTime);

        Assert.Equal(CardBadges.RecentlyAdded, Badges(series)[Key(series)]);
        _library.DidNotReceiveWithAnyArgs().GetItemList(default!);
    }

    [Theory]
    [InlineData(2, 1, CardBadges.NewSeason)]
    [InlineData(1, 1, CardBadges.NewEpisode)]
    [InlineData(2, 3, CardBadges.NewEpisode)]
    public void OldSeriesWithNewMedia_IsBadgedByItsNewestEpisode(int season, int episode, string expected)
    {
        var series = Series(created: Old, lastMediaAdded: TestData.Now.UtcDateTime.AddDays(-1));
        NewestEpisode(TestData.Episode(series, season, episode));

        Assert.Equal(expected, Badges(series)[Key(series)]);
        var query = Assert.Single(_queries);
        Assert.Same(_user, query.User);
        Assert.Equal([series.Id], query.AncestorIds);
        Assert.Equal([BaseItemKind.Episode], query.IncludeItemTypes);
        Assert.Equal(1, query.Limit);
        Assert.Equal((ItemSortBy.DateCreated, Jellyfin.Database.Implementations.Enums.SortOrder.Descending), query.OrderBy[0]);
    }

    [Fact]
    public void OldSeriesWithNewMedia_ButNoVisibleEpisode_HasNoBadge()
    {
        var series = Series(created: Old, lastMediaAdded: TestData.Now.UtcDateTime);
        NewestEpisode();

        Assert.Empty(Badges(series));
    }

    [Fact]
    public void OldSeries_WithoutRecentMedia_HasNoBadge_AndRunsNoQuery()
    {
        var stale = Series(created: Old, lastMediaAdded: Old);
        var never = Series(created: Old);

        Assert.Empty(Badges(stale, never));
        _library.DidNotReceiveWithAnyArgs().GetItemList(default!);
    }

    [Fact]
    public void OtherItemTypes_AndOldItems_AreOmitted()
    {
        var genre = new Genre { Id = Guid.NewGuid(), Name = "Drama", DateCreated = TestData.Now.UtcDateTime };
        var old = TestData.Movie("old");
        old.DateCreated = Old;

        Assert.Empty(Badges(genre, old));
    }

    [Fact]
    public void KeysAreDtoIdStrings_AndDuplicatesAreLookedUpOnce()
    {
        var series = Series(created: Old, lastMediaAdded: TestData.Now.UtcDateTime);
        NewestEpisode(TestData.Episode(series, 1, 5));

        var badges = Badges(series, series);

        Assert.Equal(series.Id.ToString("N", CultureInfo.InvariantCulture), Assert.Single(badges).Key);
        Assert.Single(_queries);
    }

    private static string Key(BaseItem item) => item.Id.ToString("N", CultureInfo.InvariantCulture);

    private static Series Series(DateTime created, DateTime? lastMediaAdded = null)
    {
        var series = TestData.Series("show");
        series.DateCreated = created;
        series.DateLastMediaAdded = lastMediaAdded;
        return series;
    }

    private void NewestEpisode(params BaseItem[] episodes) =>
        _library.GetItemList(Arg.Do<InternalItemsQuery>(_queries.Add)).Returns(episodes);

    private IReadOnlyDictionary<string, string> Badges(params BaseItem[] items) =>
        new BadgeService(_library).GetBadges(TestData.Context(_user), items);
}
