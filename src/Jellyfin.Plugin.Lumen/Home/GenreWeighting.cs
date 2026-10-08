using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Deterministic, pure helpers for genre-based personalization.</summary>
public static class GenreWeighting
{
    /// <summary>Weight = 1 (smoothing) + number of recent plays in that genre, for genres that have available items.</summary>
    public static IReadOnlyDictionary<string, double> Compute(IEnumerable<WatchedEntry> history, IEnumerable<string> availableGenres)
    {
        var weights = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var genre in availableGenres.Where(g => !string.IsNullOrWhiteSpace(g)))
        {
            weights[genre] = 1;
        }

        foreach (var genre in history.SelectMany(e => e.Genres))
        {
            if (weights.TryGetValue(genre, out var weight))
            {
                weights[genre] = weight + 1;
            }
        }

        return weights;
    }

    /// <summary>Weighted sampling without replacement.</summary>
    public static IReadOnlyList<string> Pick(IReadOnlyDictionary<string, double> weights, int count, int seed)
    {
        var random = new Random(seed);
        var pool = weights.OrderBy(w => w.Key, StringComparer.OrdinalIgnoreCase).ToList();
        var picked = new List<string>();
        while (picked.Count < count && pool.Count > 0)
        {
            var target = random.NextDouble() * pool.Sum(w => w.Value);
            var index = 0;
            for (var cumulative = pool[0].Value; cumulative < target && index < pool.Count - 1; cumulative += pool[index].Value)
            {
                index++;
            }

            picked.Add(pool[index].Key);
            pool.RemoveAt(index);
        }

        return picked;
    }

    public static IReadOnlyList<string> TopGenres(IReadOnlyDictionary<string, double> weights, int count) =>
        weights.OrderByDescending(w => w.Value).ThenBy(w => w.Key, StringComparer.OrdinalIgnoreCase).Take(count).Select(w => w.Key).ToList();

    /// <summary>A seed that is stable for a user within a UTC day and changes daily.</summary>
    public static int DailySeed(Guid userId, DateTimeOffset now)
    {
        var text = string.Create(CultureInfo.InvariantCulture, $"{userId:N}:{now.UtcDateTime:yyyy-MM-dd}");
        return BinaryPrimitives.ReadInt32LittleEndian(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    }

    public static IReadOnlyList<T> SeededShuffle<T>(IReadOnlyList<T> items, int seed)
    {
        var random = new Random(seed);
        var result = items.ToArray();
        for (var i = result.Length - 1; i > 0; i--)
        {
            var j = random.Next(i + 1);
            (result[i], result[j]) = (result[j], result[i]);
        }

        return result;
    }
}
