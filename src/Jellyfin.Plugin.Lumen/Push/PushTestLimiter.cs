using System.Collections.Concurrent;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>
/// Limits "Send a test notification" per user: one every <see cref="MinGap"/>, and <see cref="MaxPerWindow"/> per
/// <see cref="Window"/>. Each test is a call to a push service on the server's behalf, and a push service that's asked
/// too often starts refusing the server's real notifications.
/// </summary>
public sealed class PushTestLimiter
{
    public const int MaxPerWindow = 5;

    public static readonly TimeSpan MinGap = TimeSpan.FromSeconds(10);

    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);

    /// <summary>More users than this remembered and the memory starts over.</summary>
    private const int MaxUsers = 5_000;

    private readonly ConcurrentDictionary<Guid, List<DateTimeOffset>> _sent = new();
    private readonly TimeProvider _time;

    public PushTestLimiter(TimeProvider time)
    {
        _time = time;
    }

    /// <summary>Whether the user may send a test now (it then counts as sent); if not, how long to wait.</summary>
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
            sent.RemoveAll(t => now - t >= Window);
            retryAfter = sent.Count >= MaxPerWindow
                ? sent[0] + Window - now
                : sent.Count > 0 && now - sent[^1] < MinGap ? sent[^1] + MinGap - now : TimeSpan.Zero;
            if (retryAfter > TimeSpan.Zero)
            {
                return false;
            }

            sent.Add(now);
            return true;
        }
    }
}
