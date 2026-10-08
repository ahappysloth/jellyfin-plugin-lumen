using Jellyfin.Data.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class GenreProviderTests
{
    private static readonly string[] SixGenres = ["A", "B", "C", "D", "E", "F"];
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly InternalItemsQuery[] _lastQuery = new InternalItemsQuery[1];

    [Fact]
    public async Task EmitsRequestedGenreRows_FromUnplayedCandidates()
    {
        WithCandidates(TestData.Movie("a", "Drama"), TestData.Movie("b", "Comedy"), TestData.Series("c", "Sci-Fi"), TestData.Movie("d", "Drama", "Comedy"));
        var def = TestData.Section(SectionTypes.Genre, ("genreCount", "2"));

        var rows = await new GenreProvider(_library).GetRowsAsync(ContextOn(TestData.Now), def, CancellationToken.None);

        Assert.Equal(2, rows.Count);
        Assert.Equal(2, rows.Select(r => r.Title).Distinct().Count());
        Assert.All(rows, r => Assert.All(r.Items, i => Assert.Contains(r.Title, i.Genres)));
        Assert.False(_lastQuery[0].IsPlayed);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Series], _lastQuery[0].IncludeItemTypes);
    }

    [Fact]
    public async Task SelectionIsStableWithinADay_AndRotatesAcrossDays()
    {
        WithCandidates(SixGenres.Select(g => (BaseItem)TestData.Movie(g, g)).ToArray());
        var def = TestData.Section(SectionTypes.Genre, ("genreCount", "1"));
        var provider = new GenreProvider(_library);

        var morning = (await provider.GetRowsAsync(ContextOn(TestData.Now), def, CancellationToken.None))[0].Title;
        var evening = (await provider.GetRowsAsync(ContextOn(TestData.Now.AddHours(8)), def, CancellationToken.None))[0].Title;
        var acrossDays = new HashSet<string>();
        for (var d = 0; d < 10; d++)
        {
            acrossDays.Add((await provider.GetRowsAsync(ContextOn(TestData.Now.AddDays(d)), def, CancellationToken.None))[0].Title);
        }

        Assert.Equal(morning, evening);
        Assert.True(acrossDays.Count >= 2);
    }

    [Fact]
    public async Task NoCandidates_NoRows()
    {
        WithCandidates();

        Assert.Empty(await new GenreProvider(_library).GetRowsAsync(ContextOn(TestData.Now), TestData.Section(SectionTypes.Genre), CancellationToken.None));
    }

    private static HomeContext ContextOn(DateTimeOffset day, WatchHistory? history = null)
    {
        var user = new Jellyfin.Database.Implementations.Entities.User("u", "a", "r") { Id = Guid.Parse("11111111-1111-1111-1111-111111111111") };
        return new HomeContext(user, day, () => Task.FromResult(history ?? WatchHistory.Empty));
    }

    private GenreProviderTests WithCandidates(params BaseItem[] items)
    {
        _library.GetItemList(Arg.Do<InternalItemsQuery>(q => _lastQuery[0] = q)).Returns(items);
        return this;
    }
}
