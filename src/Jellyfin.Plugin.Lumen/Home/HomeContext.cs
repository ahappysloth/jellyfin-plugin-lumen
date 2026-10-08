using Jellyfin.Database.Implementations.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Per-request inputs shared by all section providers.</summary>
public sealed class HomeContext
{
    private readonly Lazy<Task<WatchHistory>> _watchHistory;

    public HomeContext(User user, DateTimeOffset now, Func<Task<WatchHistory>> watchHistory)
    {
        User = user;
        Now = now;
        _watchHistory = new Lazy<Task<WatchHistory>>(watchHistory, LazyThreadSafetyMode.ExecutionAndPublication);
    }

    public User User { get; }

    public DateTimeOffset Now { get; }

    public int ItemLimit { get; init; } = 20;

    /// <summary>Computed at most once per home build and shared across providers.</summary>
    public Task<WatchHistory> GetWatchHistoryAsync() => _watchHistory.Value;
}
