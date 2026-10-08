using Jellyfin.Plugin.Lumen.Home;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class GenreWeightingTests
{
    [Fact]
    public void Compute_SmoothsAvailableGenres_AndCountsPlaysCaseInsensitively()
    {
        var weights = GenreWeighting.Compute([Played("Drama"), Played("drama"), Played("Western")], ["Drama", "Comedy"]);

        Assert.Equal(3, weights["Drama"]);
        Assert.Equal(1, weights["Comedy"]);
        Assert.False(weights.ContainsKey("Western"));
    }

    [Fact]
    public void Pick_IsDeterministic_DistinctAndBounded()
    {
        var weights = GenreWeighting.Compute([], ["A", "B", "C", "D"]);

        var first = GenreWeighting.Pick(weights, 3, seed: 42);

        Assert.Equal(first, GenreWeighting.Pick(weights, 3, seed: 42));
        Assert.Equal(3, first.Distinct().Count());
        Assert.Equal(4, GenreWeighting.Pick(weights, 10, seed: 1).Count);
    }

    [Fact]
    public void Pick_FavorsHeavilyWatchedGenres()
    {
        var history = Enumerable.Range(0, 20).Select(_ => Played("Sci-Fi")).ToList();
        var weights = GenreWeighting.Compute(history, ["Sci-Fi", "A", "B", "C", "D", "E"]);

        var hits = Enumerable.Range(0, 30).Count(seed => GenreWeighting.Pick(weights, 1, seed)[0] == "Sci-Fi");

        Assert.True(hits >= 15, $"Sci-Fi picked {hits}/30 times");
    }

    [Fact]
    public void DailySeed_StableWithinDay_DiffersAcrossDaysAndUsers()
    {
        var user = Guid.NewGuid();

        Assert.Equal(GenreWeighting.DailySeed(user, TestData.Now), GenreWeighting.DailySeed(user, TestData.Now.AddHours(5)));
        Assert.NotEqual(GenreWeighting.DailySeed(user, TestData.Now), GenreWeighting.DailySeed(user, TestData.Now.AddDays(1)));
        Assert.NotEqual(GenreWeighting.DailySeed(user, TestData.Now), GenreWeighting.DailySeed(Guid.NewGuid(), TestData.Now));
    }

    [Fact]
    public void SeededShuffle_IsAStablePermutation()
    {
        int[] items = [1, 2, 3, 4, 5, 6, 7, 8];

        var shuffled = GenreWeighting.SeededShuffle(items, 7);

        Assert.Equal(shuffled, GenreWeighting.SeededShuffle(items, 7));
        Assert.Equal(items.Order(), shuffled.Order());
    }

    [Fact]
    public void TopGenres_OrdersByWeightThenName()
    {
        var weights = new Dictionary<string, double> { ["B"] = 2, ["A"] = 2, ["C"] = 5, ["D"] = 1 };

        Assert.Equal(["C", "A", "B"], GenreWeighting.TopGenres(weights, 3));
    }

    private static WatchedEntry Played(params string[] genres) =>
        new(TestData.Movie("m", genres), null, null, genres, TestData.Now.UtcDateTime);
}
