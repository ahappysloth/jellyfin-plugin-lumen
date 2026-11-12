using System.Collections.Concurrent;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>The signed-in user's requests and how each is going (GET /Lumen/Requests/Mine).</summary>
public interface IRequestProgressService
{
    /// <summary>
    /// The user's requested titles, newest first. Throws <see cref="SeerrException"/> when Seerr can't say (the client
    /// keeps what it last showed).
    /// </summary>
    Task<MyRequestsDto> GetAsync(Guid jellyfinUserId, User? user, SeerrEndpoint endpoint, int seerrUserId, CancellationToken cancellationToken);

    /// <summary>Forgets the user's cached answer, so a request they just filed shows on the next check.</summary>
    void Invalidate(SeerrEndpoint endpoint, int seerrUserId);
}

/// <summary>
/// Builds the user's request list from one Seerr call, <c>GET /user/{id}/requests</c>, whose media carry Radarr's and
/// Sonarr's download queues (Seerr refreshes those every minute). There's no push from Seerr, so clients poll this:
/// <list type="bullet">
/// <item>Each user's Seerr answer is cached for <see cref="Ttl"/>, and calls that arrive while one is on its way share
/// it, so a user's devices and tabs cost Seerr one call per <see cref="Ttl"/> at most. Always as that user
/// (<c>X-Api-User</c>, keyed by their Seerr id): nobody ever gets another user's requests. Saving Lumen's settings
/// starts the cache over, as it does the home cache.</item>
/// <item>Titles and art come from the shared 10-minute title cache (<see cref="ISeerrClient.GetTitleSummaryAsync"/>).</item>
/// <item>What each request's downloads looked like before (<see cref="DownloadMemory"/>) is kept in memory, so a show's
/// progress doesn't go backwards as its episodes are imported.</item>
/// </list>
/// Seerr calls go through its circuit breaker like every other user-facing call.
/// </summary>
public sealed class RequestProgressService : IRequestProgressService
{
    /// <summary>The most recent requests the list covers.</summary>
    public const int Take = 50;

    public const int MaxConcurrentDetails = 6;

    public static readonly TimeSpan Ttl = TimeSpan.FromSeconds(8);

    /// <summary>More requests than this remembered and the memory starts over (it only refines progress).</summary>
    private const int MaxMemories = 20_000;

    /// <summary>More users than this cached and the cache starts over.</summary>
    private const int MaxCached = 5_000;

    /// <summary>How long title lookups may take before the list is returned with the titles found so far.</summary>
    private static readonly TimeSpan DetailsBudget = TimeSpan.FromSeconds(4);

    private readonly ConcurrentDictionary<(string Endpoint, int User, int ConfigVersion), CacheEntry> _cache = new();
    private readonly Dictionary<(string Endpoint, int Request), DownloadMemory> _memories = [];
    private readonly Lock _memoryLock = new();
    private readonly ISeerrClient _seerr;
    private readonly ILumenConfigReader _config;
    private readonly CatalogMapper _mapper;
    private readonly IReadyAnnouncements _announcements;
    private readonly TimeProvider _time;

    public RequestProgressService(ISeerrClient seerr, ILumenConfigReader config, CatalogMapper mapper, IReadyAnnouncements announcements, TimeProvider time)
    {
        _seerr = seerr;
        _config = config;
        _mapper = mapper;
        _announcements = announcements;
        _time = time;
    }

    public async Task<MyRequestsDto> GetAsync(Guid jellyfinUserId, User? user, SeerrEndpoint endpoint, int seerrUserId, CancellationToken cancellationToken)
    {
        var tracked = await GetTrackedAsync(endpoint, seerrUserId, cancellationToken).ConfigureAwait(false);

        // One entry per title (a show's seasons are often separate requests): the request still in flight if any, else
        // the newest. The downloads are the title's, so they're the same for each.
        var titles = tracked
            .GroupBy(t => t.Key)
            .Select(g => (Primary: g.OrderByDescending(t => RequestProgressState.IsInFlight(t.Progress.State)).ThenByDescending(t => t.Request.Id).First(), All: g.ToList()))
            .OrderByDescending(t => t.All.Max(r => r.Request.CreatedAt ?? DateTimeOffset.MinValue))
            .ThenByDescending(t => t.All.Max(r => r.Request.Id))
            .ToList();

        var scope = endpoint.BaseUrl.ToString();
        var announce = _announcements.Update(
            jellyfinUserId,
            scope,
            tracked.Where(t => RequestProgressState.IsInFlight(t.Progress.State)).Select(t => t.Request.Id),
            tracked.Where(t => t.Progress.State == RequestProgressState.Ready).Select(t => t.Request.Id),
            tracked.Where(t => t.Progress.State is RequestProgressState.Declined or RequestProgressState.Failed).Select(t => t.Request.Id));

        // Not disposed: lookups still running after the budget keep using it (it holds no OS handle).
        var gate = new SemaphoreSlim(MaxConcurrentDetails);
        var lookups = titles.Select(t => ResolveAsync(endpoint, seerrUserId, t.Primary, user, gate, cancellationToken)).ToList();
        var all = Task.WhenAll(lookups);
        await Task.WhenAny(all, Task.Delay(DetailsBudget, _time, cancellationToken)).ConfigureAwait(false);
        _ = all.ContinueWith(t => _ = t.Exception, CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);

        var now = _time.GetUtcNow();
        var result = new List<MyRequestDto>(titles.Count);
        for (var i = 0; i < titles.Count; i++)
        {
            // A title Seerr couldn't describe in time is left out this once; the next check (or the warmed cache) has it.
            if (!lookups[i].IsCompletedSuccessfully || lookups[i].Result is not { } item)
            {
                continue;
            }

            var (primary, requests) = titles[i];
            var progress = primary.Progress;
            result.Add(new MyRequestDto(
                requests.Select(r => r.Request.Id).ToList(),
                item,
                progress.State,
                progress.Percent,
                progress.SecondsLeftAt(now),
                progress.EpisodesDone,
                progress.EpisodesTotal,
                requests.Min(r => r.Request.CreatedAt),
                progress.State == RequestProgressState.Ready && requests.Any(r => announce.Contains(r.Request.Id))));
        }

        return new MyRequestsDto(result);
    }

    public void Invalidate(SeerrEndpoint endpoint, int seerrUserId) => _cache.TryRemove(CacheKey(endpoint, seerrUserId), out _);

    /// <summary>The user's requests with their progress: cached for <see cref="Ttl"/>, one Seerr call at a time per user.</summary>
    internal async Task<IReadOnlyList<Tracked>> GetTrackedAsync(SeerrEndpoint endpoint, int seerrUserId, CancellationToken cancellationToken)
    {
        var key = CacheKey(endpoint, seerrUserId);
        var now = _time.GetUtcNow();
        while (true)
        {
            if (_cache.TryGetValue(key, out var entry) && (entry.Pending || entry.Fetched + Ttl > now))
            {
                try
                {
                    return await entry.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
                }
                catch (Exception) when (entry.Task.IsFaulted)
                {
                    // Every caller waiting on it gets the failure; the next call asks Seerr again.
                    _cache.TryRemove(new KeyValuePair<(string, int, int), CacheEntry>(key, entry));
                    throw;
                }
            }

            if (_cache.Count >= MaxCached)
            {
                _cache.Clear();
            }

            // Not tied to this caller's cancellation: others may be waiting on it (Seerr calls time out on their own).
            var fresh = new CacheEntry(now);
            if (entry is null ? _cache.TryAdd(key, fresh) : _cache.TryUpdate(key, fresh, entry))
            {
                fresh.Start(FetchAsync(endpoint, seerrUserId), _time);
            }
        }
    }

    private (string Endpoint, int User, int ConfigVersion) CacheKey(SeerrEndpoint endpoint, int seerrUserId) =>
        (endpoint.CacheKey, seerrUserId, _config.Current.ConfigVersion);

    private async Task<IReadOnlyList<Tracked>> FetchAsync(SeerrEndpoint endpoint, int seerrUserId)
    {
        var requests = await _seerr.GetUserRequestsAsync(endpoint, seerrUserId, CancellationToken.None, Take).ConfigureAwait(false);
        var now = _time.GetUtcNow();
        var tracked = new List<Tracked>(requests.Count);
        lock (_memoryLock)
        {
            if (_memories.Count >= MaxMemories)
            {
                _memories.Clear();
            }

            foreach (var request in requests)
            {
                var mediaType = request.Type ?? request.Media?.MediaType;
                if (request.Media is not { TmdbId: > 0 } media || !CatalogMediaType.IsValid(mediaType))
                {
                    continue;
                }

                var downloads = RequestProgress.Downloads(request);
                var memoryKey = (endpoint.CacheKey, request.Id);
                _memories.TryGetValue(memoryKey, out var memory);
                if (downloads.Count > 0)
                {
                    memory ??= _memories[memoryKey] = new DownloadMemory();
                    memory.Observe(downloads, now);
                }

                var progress = RequestProgress.Map(request, now, memory);
                if (!RequestProgressState.IsInFlight(progress.State))
                {
                    _memories.Remove(memoryKey);
                }

                tracked.Add(new Tracked(mediaType + "-" + media.TmdbId.ToString(System.Globalization.CultureInfo.InvariantCulture), mediaType!, request, progress));
            }
        }

        return tracked;
    }

    /// <summary>The card for one requested title, or null if Seerr couldn't give its details.</summary>
    private async Task<CatalogItemDto?> ResolveAsync(SeerrEndpoint endpoint, int seerrUserId, Tracked tracked, User? user, SemaphoreSlim gate, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        SeerrTitle title;
        try
        {
            title = await _seerr.GetTitleSummaryAsync(endpoint, seerrUserId, tracked.MediaType, tracked.Request.Media!.TmdbId, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException)
        {
            return null;
        }
        finally
        {
            gate.Release();
        }

        // Card fields from the (cached) details; the state and Jellyfin item from the request, which is fresh.
        var media = tracked.Request.Media!;
        var card = new SeerrMedia
        {
            MediaType = tracked.MediaType,
            Id = media.TmdbId,
            Title = title.Title,
            Name = title.Name,
            ReleaseDate = title.ReleaseDate,
            FirstAirDate = title.FirstAirDate,
            Overview = title.Overview,
            PosterPath = title.PosterPath,
            BackdropPath = title.BackdropPath,
            VoteAverage = title.VoteAverage,
            GenreIds = title.GenreIds,
            MediaInfo = new SeerrMediaInfo { Status = media.Status, JellyfinMediaId = media.JellyfinMediaId },
        };
        return _mapper.ToItem(tracked.MediaType, card, user, CatalogMapper.TitleGenreNames(title));
    }

    /// <summary>One of the user's requests, its title's key ("movie-603") and its progress when Seerr answered.</summary>
    internal sealed record Tracked(string Key, string MediaType, SeerrUserRequest Request, RequestProgressInfo Progress);

    /// <summary>A user's Seerr answer: on its way (<see cref="Pending"/>) or fetched at <see cref="Fetched"/>.</summary>
    private sealed class CacheEntry
    {
        private readonly TaskCompletionSource<IReadOnlyList<Tracked>> _source = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private long _fetched;

        public CacheEntry(DateTimeOffset started)
        {
            _fetched = started.UtcTicks;
        }

        public Task<IReadOnlyList<Tracked>> Task => _source.Task;

        public bool Pending => !_source.Task.IsCompleted;

        /// <summary>Gets when the answer arrived (the cache's age counts from then, not from when it was asked for).</summary>
        public DateTimeOffset Fetched => new(Interlocked.Read(ref _fetched), TimeSpan.Zero);

        public void Start(Task<IReadOnlyList<Tracked>> fetch, TimeProvider time) =>
            fetch.ContinueWith(
                t =>
                {
                    Interlocked.Exchange(ref _fetched, time.GetUtcNow().UtcTicks);
                    if (t.IsCompletedSuccessfully)
                    {
                        _source.TrySetResult(t.Result);
                    }
                    else
                    {
                        _source.TrySetException(t.Exception?.InnerException ?? new SeerrException("Seerr didn't answer."));
                    }
                },
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
    }
}
