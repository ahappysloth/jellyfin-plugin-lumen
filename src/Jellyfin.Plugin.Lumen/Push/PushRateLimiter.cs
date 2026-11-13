using System.Collections.Concurrent;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>
/// Limits something per user: one every <c>minGap</c>, and <c>maxPerWindow</c> per <c>window</c>. In memory, so a
/// restart starts the counts over.
/// </summary>
public class PushRateLimiter
{
    /// <summary>More users than this remembered and the memory starts over.</summary>
    private const int MaxUsers = 5_000;

    private readonly ConcurrentDictionary<Guid, List<DateTimeOffset>> _sent = new();
    private readonly TimeProvider _time;
    private readonly TimeSpan _minGap;
    private readonly int _maxPerWindow;
    private readonly TimeSpan _window;

    protected PushRateLimiter(TimeProvider time, TimeSpan minGap, int maxPerWindow, TimeSpan window)
    {
        _time = time;
        _minGap = minGap;
        _maxPerWindow = maxPerWindow;
        _window = window;
    }

    /// <summary>Whether the user may do it now (it then counts as done); if not, how long to wait.</summary>
    public bool TryAcquire(Guid userId, out TimeSpan retryAfter)
    {
        var now = _time.GetUtcNow();
        if (_sent.Count >= MaxUsers)
        {
            _sent.Clear();
        }

        var sent = _sent.GetOrAdd(userId, _ => []);
        lock (sent)
        {
            sent.RemoveAll(t => now - t >= _window);
            retryAfter = sent.Count >= _maxPerWindow
                ? sent[0] + _window - now
                : sent.Count > 0 && now - sent[^1] < _minGap ? sent[^1] + _minGap - now : TimeSpan.Zero;
            if (retryAfter > TimeSpan.Zero)
            {
                return false;
            }

            sent.Add(now);
            return true;
        }
    }
}

/// <summary>
/// Limits "Send a test notification" per user: one every <see cref="MinGap"/>, and <see cref="MaxPerWindow"/> per
/// <see cref="Window"/>. Each test is a call to a push service on the server's behalf, and a push service that's asked
/// too often starts refusing the server's real notifications.
/// </summary>
public sealed class PushTestLimiter : PushRateLimiter
{
    public const int MaxPerWindow = 5;

    public static readonly TimeSpan MinGap = TimeSpan.FromSeconds(10);

    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);

    public PushTestLimiter(TimeProvider time)
        : base(time, MinGap, MaxPerWindow, Window)
    {
    }
}

/// <summary>
/// Limits turning notifications on per user: <see cref="MaxPerWindow"/> subscriptions stored per <see cref="Window"/>.
/// A device stores one when its switch is tapped, and at most one more per page load to repair itself; each is a file
/// written to the disk, which a script holding a user's token shouldn't be able to keep busy.
/// </summary>
public sealed class PushSubscribeLimiter : PushRateLimiter
{
    public const int MaxPerWindow = 20;

    public static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    public PushSubscribeLimiter(TimeProvider time)
        : base(time, TimeSpan.Zero, MaxPerWindow, Window)
    {
    }
}
