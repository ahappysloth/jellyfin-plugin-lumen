using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>
/// A simple circuit breaker for user-facing Seerr calls (requests design spec, §7): after <see cref="Threshold"/>
/// consecutive failures every call fails fast for <see cref="OpenFor"/>. After that the next call is let through; if it
/// fails the breaker opens again straight away, if it succeeds the breaker closes. Opening and closing are logged once.
/// </summary>
public sealed class SeerrCircuitBreaker
{
    public const int Threshold = 3;
    public static readonly TimeSpan OpenFor = TimeSpan.FromMinutes(1);

    private readonly Lock _lock = new();
    private readonly TimeProvider _time;
    private readonly ILogger _logger;
    private int _failures;
    private DateTimeOffset _openUntil = DateTimeOffset.MinValue;
    private bool _tripped;

    public SeerrCircuitBreaker(TimeProvider time, ILogger logger)
    {
        _time = time;
        _logger = logger;
    }

    /// <summary>Gets a value indicating whether calls should fail fast right now.</summary>
    public bool IsOpen
    {
        get
        {
            lock (_lock)
            {
                return _openUntil > _time.GetUtcNow();
            }
        }
    }

    public void RecordSuccess()
    {
        lock (_lock)
        {
            if (_tripped)
            {
                _logger.LogInformation("Lumen's Seerr connection recovered; request features are back.");
            }

            _failures = 0;
            _openUntil = DateTimeOffset.MinValue;
            _tripped = false;
        }
    }

    public void RecordFailure()
    {
        lock (_lock)
        {
            _failures++;
            var now = _time.GetUtcNow();
            if (_failures < Threshold || _openUntil > now)
            {
                return;
            }

            _openUntil = now + OpenFor;
            if (!_tripped)
            {
                _tripped = true;
                _logger.LogWarning(
                    "Lumen's Seerr calls failed {Count} times in a row; request features are paused for {Duration}.",
                    _failures,
                    OpenFor);
            }
        }
    }
}

/// <summary>
/// A small server-wide cache for Seerr responses that are the same for everyone (discover lists, title summaries), so
/// home rows don't call Seerr for every user. Bounded to <see cref="Capacity"/> entries, evicting the oldest first.
/// </summary>
public sealed class SeerrResponseCache
{
    public const int Capacity = 200;
    public static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);

    private readonly Lock _lock = new();
    private readonly Dictionary<string, Entry> _entries = new(StringComparer.Ordinal);
    private readonly TimeProvider _time;
    private long _sequence;

    public SeerrResponseCache(TimeProvider time)
    {
        _time = time;
    }

    public int Count
    {
        get
        {
            lock (_lock)
            {
                return _entries.Count;
            }
        }
    }

    public bool TryGet<T>(string key, out T value)
        where T : class
    {
        lock (_lock)
        {
            if (_entries.TryGetValue(key, out var entry) && entry.Expires > _time.GetUtcNow() && entry.Value is T found)
            {
                value = found;
                return true;
            }
        }

        value = null!;
        return false;
    }

    public void Set(string key, object value)
    {
        lock (_lock)
        {
            var now = _time.GetUtcNow();
            _entries.Remove(key);
            if (_entries.Count >= Capacity)
            {
                foreach (var expired in _entries.Where(e => e.Value.Expires <= now).Select(e => e.Key).ToList())
                {
                    _entries.Remove(expired);
                }
            }

            while (_entries.Count >= Capacity)
            {
                _entries.Remove(_entries.MinBy(e => e.Value.Sequence).Key);
            }

            _entries[key] = new Entry(value, now + Ttl, ++_sequence);
        }
    }

    private sealed record Entry(object Value, DateTimeOffset Expires, long Sequence);
}
