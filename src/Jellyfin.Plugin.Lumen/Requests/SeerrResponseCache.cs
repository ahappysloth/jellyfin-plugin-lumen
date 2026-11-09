namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>
/// A small server-wide cache for Seerr responses that many users share (discover lists, title summaries; the key says who
/// may share an entry, see <see cref="SeerrClient"/>), so home rows don't call Seerr for every user. Bounded to
/// <see cref="Capacity"/> entries, evicting the oldest first.
/// </summary>
public sealed class SeerrResponseCache
{
    public const int Capacity = 500;
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

    public void Clear()
    {
        lock (_lock)
        {
            _entries.Clear();
        }
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
