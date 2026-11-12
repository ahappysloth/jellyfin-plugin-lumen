using Jellyfin.Plugin.Lumen.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Top10;

/// <summary>Trakt's weekly lists for the Top 10 rows, shared by every user.</summary>
public interface ITop10Lists
{
    /// <summary>
    /// The week's most watched titles, most watched first; null when there's no Trakt key, or Trakt failed and there's no
    /// earlier list to serve (the rows then fall back to Seerr's trending list).
    /// </summary>
    Task<IReadOnlyList<TraktTitle>?> GetAsync(TraktListKind kind, CancellationToken cancellationToken);
}

/// <summary>
/// Caches each Trakt list server-wide for <see cref="FreshFor"/>: the list is the same for everyone and changes slowly,
/// so a home load almost never waits for Trakt. A stale list is served at once while one refresh runs in the
/// background; only the very first load waits, and for at most <see cref="TraktClient.Timeout"/>. When Trakt fails, the
/// last good list keeps being served, Trakt isn't asked again for <see cref="RetryAfter"/>, and the failure is logged
/// once (and the recovery once), not on every home load. A new key starts over.
/// </summary>
public sealed class Top10Lists : ITop10Lists
{
    /// <summary>Asked of Trakt: more than the row shows, so it still fills when titles are skipped (not on the server, no
    /// Seerr, or hidden from the user).</summary>
    public const int FetchLimit = 40;

    public static readonly TimeSpan FreshFor = TimeSpan.FromHours(3);
    public static readonly TimeSpan RetryAfter = TimeSpan.FromMinutes(10);

    private readonly Lock _lock = new();
    private readonly Dictionary<TraktListKind, State> _states = [];
    private readonly ILumenConfigReader _config;
    private readonly ITraktClient _trakt;
    private readonly TimeProvider _time;
    private readonly ILogger<Top10Lists> _logger;

    public Top10Lists(ILumenConfigReader config, ITraktClient trakt, TimeProvider time, ILogger<Top10Lists> logger)
    {
        _config = config;
        _trakt = trakt;
        _time = time;
        _logger = logger;
    }

    public async Task<IReadOnlyList<TraktTitle>?> GetAsync(TraktListKind kind, CancellationToken cancellationToken)
    {
        var key = _config.Current.TraktClientId;
        if (string.IsNullOrWhiteSpace(key))
        {
            return null;
        }

        IReadOnlyList<TraktTitle>? list;
        Task<IReadOnlyList<TraktTitle>?> refresh;
        lock (_lock)
        {
            if (!_states.TryGetValue(kind, out var state) || !string.Equals(state.Key, key, StringComparison.Ordinal))
            {
                state = new State(key);
                _states[kind] = state;
            }

            var now = _time.GetUtcNow();
            list = state.List;
            if ((list is not null && now < state.FetchedAt + FreshFor) || now < state.RetryAt)
            {
                return list;
            }

            // Not tied to this caller: a home load that gives up mustn't cancel the fetch the next one will want.
            refresh = state.Refresh ??= Task.Run(() => RefreshAsync(kind, state), CancellationToken.None);
        }

        return list ?? await refresh.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task<IReadOnlyList<TraktTitle>?> RefreshAsync(TraktListKind kind, State state)
    {
        try
        {
            var titles = await _trakt.GetWeeklyWatchedAsync(state.Key, kind, FetchLimit, CancellationToken.None).ConfigureAwait(false);
            lock (_lock)
            {
                state.List = titles;
                state.FetchedAt = _time.GetUtcNow();
                state.RetryAt = DateTimeOffset.MinValue;
                if (state.Failing)
                {
                    state.Failing = false;
                    _logger.LogInformation("Lumen's Top 10 rows reach Trakt again.");
                }

                return titles;
            }
        }
        catch (TraktException e)
        {
            lock (_lock)
            {
                state.RetryAt = _time.GetUtcNow() + RetryAfter;
                if (!state.Failing)
                {
                    state.Failing = true;
                    _logger.LogWarning(
                        "Lumen couldn't load Trakt's weekly {Kind} list, so its Top 10 row shows {Fallback}: {Message}",
                        kind == TraktListKind.Movies ? "movies" : "shows",
                        state.List is null ? "Seerr's trending titles" : "the last list it had",
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

    /// <summary>One list's cache, for one key. Guarded by <see cref="_lock"/>.</summary>
    private sealed class State
    {
        public State(string key)
        {
            Key = key;
        }

        public string Key { get; }

        public IReadOnlyList<TraktTitle>? List { get; set; }

        public DateTimeOffset FetchedAt { get; set; }

        public DateTimeOffset RetryAt { get; set; } = DateTimeOffset.MinValue;

        public Task<IReadOnlyList<TraktTitle>?>? Refresh { get; set; }

        public bool Failing { get; set; }
    }
}
