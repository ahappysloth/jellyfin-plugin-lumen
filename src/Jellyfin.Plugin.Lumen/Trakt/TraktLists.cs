using Jellyfin.Plugin.Lumen.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Trakt;

/// <summary>Trakt's lists for the Trakt rows and the Top charts page, shared by every user.</summary>
public interface ITraktLists
{
    /// <summary>Gets a value indicating whether a Trakt key is saved (the Top charts page and the Trakt rows need one).</summary>
    bool Enabled { get; }

    /// <summary>
    /// The list, or null when there's no Trakt key, or Trakt failed and there's no earlier copy to serve, or a user's list
    /// is private or gone (the rows that use it are then hidden, or the Top 10 rows fall back to Seerr's trending list).
    /// </summary>
    Task<TraktList?> GetAsync(TraktQuery query, CancellationToken cancellationToken);
}

/// <summary>A copy of a Trakt list: its titles in Trakt's order, and for a user's list its name.</summary>
public sealed record TraktList(IReadOnlyList<TraktTitle> Titles, string? Name = null);

/// <summary>
/// Caches each Trakt list server-wide for its query's <see cref="TraktQuery.FreshFor"/>: a list is the same for everyone
/// and changes slowly, so a home load almost never waits for Trakt. A stale list is served at once while one refresh runs
/// in the background; only the very first load waits, and for at most <see cref="TraktClient.Timeout"/> a call. When
/// Trakt fails, the last good list keeps being served, Trakt isn't asked about that list again for <see cref="RetryAfter"/>,
/// and the failure is logged once (and the recovery once), not on every home load. A user's list that turns out to be
/// private or gone is dropped instead, so its row hides. A new key starts over. A list nobody has asked for in
/// <see cref="ForgetAfter"/> (a row removed, a list address changed) is forgotten.
/// <para>
/// Trakt allows 1000 GETs per 5 minutes per app. This asks at most once per list per freshness period (or per back-off
/// after a failure): a few dozen calls an hour for every chart, row and list Lumen can show together.
/// </para>
/// </summary>
public sealed class TraktLists : ITraktLists
{
    public static readonly TimeSpan RetryAfter = TimeSpan.FromMinutes(10);

    /// <summary>A day: longer than any list's freshness, so a list in use is never forgotten between two home loads.</summary>
    public static readonly TimeSpan ForgetAfter = TimeSpan.FromHours(24);

    /// <summary>How often, at most, lists are checked for ones to forget.</summary>
    private static readonly TimeSpan PruneEvery = TimeSpan.FromHours(1);

    private readonly Lock _lock = new();
    private readonly Dictionary<TraktQuery, State> _states = [];
    private readonly ILumenConfigReader _config;
    private readonly ITraktClient _trakt;
    private readonly TimeProvider _time;
    private readonly ILogger<TraktLists> _logger;
    private DateTimeOffset _prunedAt;

    public TraktLists(ILumenConfigReader config, ITraktClient trakt, TimeProvider time, ILogger<TraktLists> logger)
    {
        _config = config;
        _trakt = trakt;
        _time = time;
        _logger = logger;
    }

    public bool Enabled => !string.IsNullOrWhiteSpace(_config.Current.TraktClientId);

    /// <summary>Gets how many lists are cached (tests).</summary>
    internal int CachedCount
    {
        get
        {
            lock (_lock)
            {
                return _states.Count;
            }
        }
    }

    public async Task<TraktList?> GetAsync(TraktQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var key = _config.Current.TraktClientId;
        if (string.IsNullOrWhiteSpace(key))
        {
            return null;
        }

        TraktList? list;
        Task<TraktList?> refresh;
        lock (_lock)
        {
            var now = _time.GetUtcNow();
            Prune(now);
            if (!_states.TryGetValue(query, out var state) || !string.Equals(state.Key, key, StringComparison.Ordinal))
            {
                state = new State(key);
                _states[query] = state;
            }

            state.AskedAt = now;
            list = state.List;
            if ((list is not null && now < state.FetchedAt + query.FreshFor) || now < state.RetryAt)
            {
                return list;
            }

            // Not tied to this caller: a home load that gives up mustn't cancel the fetch the next one will want.
            refresh = state.Refresh ??= Task.Run(() => RefreshAsync(query, state), CancellationToken.None);
        }

        return list ?? await refresh.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task<TraktList?> RefreshAsync(TraktQuery query, State state)
    {
        try
        {
            // A user's list's name and items at once: one after the other, a first load could take two of Trakt's
            // timeouts, as long as the row's. Both fail for a private or deleted list; the name's error is the one thrown,
            // so whichever lands first, the list is known to be gone.
            var nameTask = query.List is { } listRef
                ? _trakt.GetListNameAsync(state.Key, listRef, CancellationToken.None)
                : Task.FromResult<string?>(null);
            var titlesTask = _trakt.GetTitlesAsync(state.Key, query, CancellationToken.None);
            await ((Task)Task.WhenAll(nameTask, titlesTask)).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
            var name = await nameTask.ConfigureAwait(false);
            var titles = await titlesTask.ConfigureAwait(false);
            var list = new TraktList(titles, name);
            lock (_lock)
            {
                state.List = list;
                state.FetchedAt = _time.GetUtcNow();
                state.RetryAt = DateTimeOffset.MinValue;
                if (state.Failing)
                {
                    state.Failing = false;
                    if (_logger.IsEnabled(LogLevel.Information))
                    {
                        _logger.LogInformation("Lumen reaches Trakt's {List} again.", query.Name);
                    }
                }

                return list;
            }
        }
        catch (TraktException e)
        {
            lock (_lock)
            {
                state.RetryAt = _time.GetUtcNow() + RetryAfter;

                // A list made private or deleted is gone for its row too, rather than shown as it was.
                var gone = query.List is not null && e.IsMissing;
                if (gone)
                {
                    state.List = null;
                }

                if (!state.Failing)
                {
                    state.Failing = true;
                    _logger.LogWarning(
                        "Lumen couldn't load Trakt's {List}, so {Consequence}: {Message}",
                        query.Name,
                        gone ? "its row is hidden" : state.List is null ? "what uses it is hidden or falls back for now" : "it shows the last copy it had",
                        e.Message);
                }

                return state.List;
            }
        }
        finally
        {
            lock (_lock)
            {
                state.Refresh = null;
            }
        }
    }

    /// <summary>Forgets the lists nobody has asked for in <see cref="ForgetAfter"/>, at most every <see cref="PruneEvery"/>.</summary>
    private void Prune(DateTimeOffset now)
    {
        if (now < _prunedAt + PruneEvery)
        {
            return;
        }

        _prunedAt = now;
        foreach (var (query, state) in _states.Where(s => s.Value.Refresh is null && now - s.Value.AskedAt >= ForgetAfter).ToList())
        {
            _states.Remove(query);
        }
    }

    /// <summary>One list's cache, for one key. Guarded by <see cref="_lock"/>.</summary>
    private sealed class State
    {
        public State(string key)
        {
            Key = key;
        }

        public string Key { get; }

        public TraktList? List { get; set; }

        public DateTimeOffset FetchedAt { get; set; }

        public DateTimeOffset RetryAt { get; set; } = DateTimeOffset.MinValue;

        public Task<TraktList?>? Refresh { get; set; }

        public bool Failing { get; set; }

        /// <summary>Gets or sets when the list was last asked for.</summary>
        public DateTimeOffset AskedAt { get; set; }
    }
}
