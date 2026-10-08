using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Jellyfin.Plugin.Lumen.Api;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>
/// One cached home response per user, valid for <see cref="Ttl"/>. A user's entry is evicted when their playback data
/// changes. Library changes bump a generation counter (at most once per <see cref="LibraryDebounce"/>, with a
/// trailing bump), which invalidates every entry without walking the cache.
/// </summary>
public sealed class HomeCache : IDisposable
{
    public static readonly TimeSpan Ttl = TimeSpan.FromSeconds(60);

    /// <summary>The shorter lifetime of a degraded response (a provider or the hero failed or timed out).</summary>
    public static readonly TimeSpan DegradedTtl = TimeSpan.FromSeconds(10);
    public static readonly TimeSpan LibraryDebounce = TimeSpan.FromSeconds(30);

    private readonly ConcurrentDictionary<Guid, Entry> _entries = new();
    private readonly ConcurrentDictionary<Guid, long> _userVersions = new();
    private readonly Lock _gate = new();
    private readonly IUserDataManager _userDataManager;
    private readonly ILibraryManager _libraryManager;
    private readonly TimeProvider _time;
    private long _generation;
    private DateTimeOffset _lastBump = DateTimeOffset.MinValue;
    private ITimer? _trailingBump;

    public HomeCache(IUserDataManager userDataManager, ILibraryManager libraryManager, TimeProvider time)
    {
        _userDataManager = userDataManager;
        _libraryManager = libraryManager;
        _time = time;
        _userDataManager.UserDataSaved += OnUserDataSaved;
        _libraryManager.ItemAdded += OnItemChanged;
        _libraryManager.ItemUpdated += OnItemChanged;
        _libraryManager.ItemRemoved += OnItemChanged;
    }

    public long LibraryGeneration => Interlocked.Read(ref _generation);

    public CacheStamp Stamp(Guid userId) =>
        new(LibraryGeneration, _userVersions.TryGetValue(userId, out var version) ? version : 0);

    public bool TryGet(Guid userId, int configVersion, [NotNullWhen(true)] out HomeResponseDto? value)
    {
        if (_entries.TryGetValue(userId, out var entry)
            && entry.Generation == LibraryGeneration
            && entry.ConfigVersion == configVersion
            && entry.ExpiresAt > _time.GetUtcNow())
        {
            value = entry.Value;
            return true;
        }

        value = null;
        return false;
    }

    /// <summary>
    /// Stores the response only if nothing relevant changed since <paramref name="stamp"/> was taken; otherwise the
    /// response is silently dropped. A <paramref name="degraded"/> response lives only <see cref="DegradedTtl"/>.
    /// </summary>
    public void Set(Guid userId, int configVersion, CacheStamp stamp, HomeResponseDto value, bool degraded = false)
    {
        if (stamp != Stamp(userId))
        {
            return;
        }

        _entries[userId] = new Entry(stamp.LibraryGeneration, configVersion, _time.GetUtcNow() + (degraded ? DegradedTtl : Ttl), value);

        // An invalidation that raced with the store above would otherwise leave a stale entry behind.
        if (stamp != Stamp(userId))
        {
            _entries.TryRemove(userId, out _);
        }
    }

    public void InvalidateUser(Guid userId)
    {
        _userVersions.AddOrUpdate(userId, 1, static (_, version) => version + 1);
        _entries.TryRemove(userId, out _);
    }

    public void Dispose()
    {
        _userDataManager.UserDataSaved -= OnUserDataSaved;
        _libraryManager.ItemAdded -= OnItemChanged;
        _libraryManager.ItemUpdated -= OnItemChanged;
        _libraryManager.ItemRemoved -= OnItemChanged;
        lock (_gate)
        {
            _trailingBump?.Dispose();
            _trailingBump = null;
        }
    }

    private void OnUserDataSaved(object? sender, UserDataSaveEventArgs e) => InvalidateUser(e.UserId);

    private void OnItemChanged(object? sender, ItemChangeEventArgs e)
    {
        lock (_gate)
        {
            var now = _time.GetUtcNow();
            if (now - _lastBump >= LibraryDebounce)
            {
                // The leading bump supersedes any trailer still waiting, so the trailer cannot bump again in this window.
                _trailingBump?.Dispose();
                _trailingBump = null;
                Bump(now);
            }
            else
            {
                _trailingBump ??= _time.CreateTimer(_ => OnTrailingBump(), null, _lastBump + LibraryDebounce - now, Timeout.InfiniteTimeSpan);
            }
        }
    }

    private void OnTrailingBump()
    {
        lock (_gate)
        {
            _trailingBump?.Dispose();
            _trailingBump = null;
            Bump(_time.GetUtcNow());
        }
    }

    private void Bump(DateTimeOffset now)
    {
        Interlocked.Increment(ref _generation);
        _lastBump = now;
    }

    /// <summary>The versions a response must still match to be stored. Take it before building the response.</summary>
    public readonly record struct CacheStamp(long LibraryGeneration, long UserVersion);

    private sealed record Entry(long Generation, int ConfigVersion, DateTimeOffset ExpiresAt, HomeResponseDto Value);
}
