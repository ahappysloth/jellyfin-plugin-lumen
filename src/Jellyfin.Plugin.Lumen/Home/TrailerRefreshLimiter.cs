namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>
/// Limits Media info's "Check again" (an administrator asking IMDb and Seerr again for one title, past the cache): one
/// per title every <see cref="PerTitleGap"/>, and <see cref="MaxPerWindow"/> per user in <see cref="Window"/>. Each one
/// is a call to IMDb on the server's behalf, and IMDb asked too often starts refusing everyone's lookups. In memory, so
/// a restart starts the counts over; bounded by <see cref="MaxEntries"/>.
/// </summary>
public sealed class TrailerRefreshLimiter
{
    public const int MaxPerWindow = 20;

    public static readonly TimeSpan PerTitleGap = TimeSpan.FromSeconds(30);

    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);

    /// <summary>More users or titles than this remembered and the memory starts over.</summary>
    private const int MaxEntries = 5_000;

    private readonly Lock _lock = new();
    private readonly Dictionary<(Guid User, string Title), DateTimeOffset> _titles = [];
    private readonly Dictionary<Guid, Queue<DateTimeOffset>> _users = [];
    private readonly TimeProvider _time;

    public TrailerRefreshLimiter(TimeProvider time)
    {
        _time = time;
    }

    /// <summary>Whether the user may check <paramref name="title"/> again now (it then counts); if not, how long to wait.</summary>
    public bool TryAcquire(Guid userId, string title, out TimeSpan retryAfter)
    {
        var now = _time.GetUtcNow();
        lock (_lock)
        {
            if (_titles.Count >= MaxEntries || _users.Count >= MaxEntries)
            {
                _titles.Clear();
                _users.Clear();
            }

            if (!_users.TryGetValue(userId, out var recent))
            {
                recent = new Queue<DateTimeOffset>();
                _users[userId] = recent;
            }

            while (recent.Count > 0 && now - recent.Peek() >= Window)
            {
                recent.Dequeue();
            }

            var key = (userId, title);
            retryAfter = recent.Count >= MaxPerWindow
                ? recent.Peek() + Window - now
                : _titles.TryGetValue(key, out var last) && now - last < PerTitleGap ? last + PerTitleGap - now : TimeSpan.Zero;
            if (retryAfter > TimeSpan.Zero)
            {
                return false;
            }

            recent.Enqueue(now);
            _titles[key] = now;
            return true;
        }
    }
}
