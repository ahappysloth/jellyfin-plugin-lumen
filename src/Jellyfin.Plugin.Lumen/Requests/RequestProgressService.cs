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

    /// <summary>
    /// The user's titles that became ready and nobody has been told about, taken: the caller announces them (a push
    /// notification), and no pop-up shows for them. From the same cached Seerr answer as <see cref="GetAsync"/>.
    /// <paramref name="alsoWatch"/> are requests to announce even if Lumen never saw them in flight (Seerr's webhook
    /// named them); only the user's own count. Say how it went for each: <see cref="Delivered"/>, or what couldn't be
    /// announced with <see cref="GiveBack"/> or <see cref="Release"/>. Throws <see cref="SeerrException"/> when Seerr
    /// can't say.
    /// </summary>
    Task<IReadOnlyList<ReadyTitle>> ClaimReadyAsync(Guid jellyfinUserId, User? user, SeerrEndpoint endpoint, int seerrUserId, IReadOnlyCollection<int>? alsoWatch, CancellationToken cancellationToken);

    /// <summary>
    /// These requests, taken by <see cref="ClaimReadyAsync"/>, were announced: a device got the push. Until this (or
    /// one of the two below) is said, a request counts as cut short if Jellyfin is killed, and is due again after.
    /// </summary>
    void Delivered(Guid jellyfinUserId, SeerrEndpoint endpoint, IEnumerable<int> requestIds);

    /// <summary>These requests, taken by <see cref="ClaimReadyAsync"/>, weren't announced after all: they're due again.</summary>
    void GiveBack(Guid jellyfinUserId, SeerrEndpoint endpoint, IEnumerable<int> requestIds);

    /// <summary>
    /// These requests, taken by <see cref="ClaimReadyAsync"/>, couldn't be pushed to any of the user's devices: they're
    /// left to the pop-up, which shows them the next time the user has Lumen open, notifications on or not.
    /// </summary>
    void Release(Guid jellyfinUserId, SeerrEndpoint endpoint, IEnumerable<int> requestIds);
}

/// <summary>
/// A title that's ready to watch, with the user's requests for it that are being announced. <c>Item</c> is null when
/// Seerr couldn't describe the title in time.
/// </summary>
public sealed record ReadyTitle(string Key, IReadOnlyList<int> RequestIds, CatalogItemDto? Item);

/// <summary>
/// Builds the user's request list from one Seerr call, <c>GET /user/{id}/requests</c>, whose media carry Radarr's and
/// Sonarr's download queues (Seerr refreshes those every minute). There's no push from Seerr, so clients poll this:
/// <list type="bullet">
/// <item>Each user's Seerr answer is cached for <see cref="Ttl"/>, and calls that arrive while one is on its way share
/// it, so a user's devices and tabs cost Seerr one call per <see cref="Ttl"/> at most. Always as that user
/// (<c>X-Api-User</c>, keyed by their Seerr id): nobody ever gets another user's requests. Saving Lumen's settings
/// starts the cache over, as it does the home cache.</item>
/// <item>Titles and art come from the shared 10-minute title cache (<see cref="ISeerrClient.GetTitleSummaryAsync"/>).</item>
/// <item>What each requested title's queue looked like before (<see cref="DownloadMemory"/>) is kept in memory, so a
/// show's progress doesn't go backwards as its episodes are imported.</item>
/// </list>
/// Seerr calls go through its circuit breaker like every other user-facing call, except that a 5xx from this per-user
/// call doesn't count (see <see cref="ISeerrClient.GetUserRequestsAsync"/>); a failure is cached for
/// <see cref="FailureTtl"/>.
/// </summary>
public sealed class RequestProgressService : IRequestProgressService
{
    /// <summary>The most recent requests the list covers.</summary>
    public const int Take = 50;

    public const int MaxConcurrentDetails = 6;

    public static readonly TimeSpan Ttl = TimeSpan.FromSeconds(8);

    /// <summary>
    /// How long a user's failed Seerr call is answered from the cache: several tabs or devices of one user can't keep a
    /// failing Seerr call going. Shorter than the client's first retry (at least 7.5 s), so that retry really asks Seerr.
    /// </summary>
    public static readonly TimeSpan FailureTtl = TimeSpan.FromSeconds(5);

    /// <summary>
    /// A request that has waited this long for an admin's approval, or for a release to download (a title that isn't out
    /// yet), isn't expected to be ready any minute: the push job asks about it every half hour, not every pass.
    /// </summary>
    public static readonly TimeSpan WaitingAfter = TimeSpan.FromDays(1);

    /// <summary>How long title lookups may take before the list is returned with the titles found so far.</summary>
    internal static readonly TimeSpan DetailsBudget = TimeSpan.FromSeconds(4);

    /// <summary>More requests than this remembered and the memory starts over (it only refines progress).</summary>
    private const int MaxMemories = 20_000;

    /// <summary>More users than this cached and the cache starts over.</summary>
    private const int MaxCached = 5_000;

    private static readonly IReadOnlySet<int> EmptySet = new HashSet<int>();

    private readonly ConcurrentDictionary<(string Endpoint, int User, int ConfigVersion), SharedAnswer<IReadOnlyList<TrackedTitle>>> _cache = new();
    private readonly Dictionary<(string Endpoint, int User, string Title, bool Is4k), DownloadMemory> _memories = [];
    private readonly Lock _memoryLock = new();
    private readonly ISeerrClient _seerr;
    private readonly ILumenConfigReader _config;
    private readonly CatalogMapper _mapper;
    private readonly IReadyAnnouncements _announcements;
    private readonly IReadyPushSignal _push;
    private readonly TimeProvider _time;

    public RequestProgressService(ISeerrClient seerr, ILumenConfigReader config, CatalogMapper mapper, IReadyAnnouncements announcements, IReadyPushSignal push, TimeProvider time)
    {
        _seerr = seerr;
        _config = config;
        _mapper = mapper;
        _announcements = announcements;
        _push = push;
        _time = time;
    }

    public async Task<MyRequestsDto> GetAsync(Guid jellyfinUserId, User? user, SeerrEndpoint endpoint, int seerrUserId, CancellationToken cancellationToken)
    {
        var titles = await GetTrackedAsync(endpoint, seerrUserId, cancellationToken).ConfigureAwait(false);
        var tracked = titles.SelectMany(t => t.All).ToList();

        var scope = endpoint.BaseUrl.ToString();
        var announce = _announcements.Update(
            jellyfinUserId,
            scope,
            tracked.Where(t => RequestProgressState.IsInFlight(t.Progress.State)).Select(t => t.Request.Id),
            tracked.Where(t => t.Progress.State == RequestProgressState.Ready).Select(t => t.Request.Id),
            Waiting(tracked));

        // A user with notifications on is told by a push, on every device they turned them on in, and by no pop-up:
        // the push job takes the requests itself (ClaimReadyAsync), so the two can never both announce one. Only what
        // the job gave up on (no device could be reached for minutes) is the pop-up's, so the user still hears of it.
        if (announce.Count > 0 && _push.Covers(jellyfinUserId))
        {
            var popUpOnly = _announcements.PopUpOnly(jellyfinUserId, scope);
            if (announce.Any(id => !popUpOnly.Contains(id)))
            {
                _push.Wake(jellyfinUserId);
            }

            announce = popUpOnly.Count == 0 ? EmptySet : announce.Where(popUpOnly.Contains).ToHashSet();
        }

        // Not disposed: lookups still running after the budget keep using it (it holds no OS handle).
        var gate = new SemaphoreSlim(MaxConcurrentDetails);
        var lookups = titles.Select(t => ResolveAsync(_seerr, _mapper, endpoint, seerrUserId, t.Primary, user, gate, cancellationToken)).ToList();
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

            var title = titles[i];
            var progress = title.Shown;
            result.Add(new MyRequestDto(
                title.All.Select(r => r.Request.Id).ToList(),
                item,
                progress.State,
                progress.Percent,
                progress.SecondsLeftAt(now),
                progress.EpisodesDone,
                progress.EpisodesTotal,
                title.All.Min(r => r.Request.CreatedAt),
                progress.State == RequestProgressState.Ready && title.All.Any(r => announce.Contains(r.Request.Id))));
        }

        return new MyRequestsDto(result);
    }

    public void Invalidate(SeerrEndpoint endpoint, int seerrUserId) => _cache.TryRemove(CacheKey(endpoint, seerrUserId), out _);

    public async Task<IReadOnlyList<ReadyTitle>> ClaimReadyAsync(Guid jellyfinUserId, User? user, SeerrEndpoint endpoint, int seerrUserId, IReadOnlyCollection<int>? alsoWatch, CancellationToken cancellationToken)
    {
        var titles = await GetTrackedAsync(endpoint, seerrUserId, cancellationToken).ConfigureAwait(false);
        var tracked = titles.SelectMany(t => t.All).ToList();

        // As for the pop-up: a title is announced once all of it that's in flight is ready (a show with another season
        // still downloading waits for that one), so it's one notification per title.
        var ready = titles
            .Where(t => t.Shown.State == RequestProgressState.Ready)
            .SelectMany(t => t.All)
            .Where(t => t.Progress.State == RequestProgressState.Ready)
            .Select(t => t.Request.Id)
            .ToList();
        var claimed = _announcements.Claim(
            jellyfinUserId,
            endpoint.BaseUrl.ToString(),
            tracked.Where(t => RequestProgressState.IsInFlight(t.Progress.State)).Select(t => t.Request.Id),
            ready,
            Waiting(tracked),
            ready.Where(id => alsoWatch?.Contains(id) == true),
            tracked.Where(t => t.Progress.State == RequestProgressState.Ready).Select(t => t.Request.Id).Except(ready));
        if (claimed.Count == 0)
        {
            return [];
        }

        var due = titles.Where(t => t.All.Any(r => claimed.Contains(r.Request.Id))).ToList();
        var gate = new SemaphoreSlim(MaxConcurrentDetails);
        var lookups = due.Select(t => ResolveAsync(_seerr, _mapper, endpoint, seerrUserId, t.Primary, user, gate, cancellationToken)).ToList();
        var all = Task.WhenAll(lookups);
        await Task.WhenAny(all, Task.Delay(DetailsBudget, _time, cancellationToken)).ConfigureAwait(false);
        _ = all.ContinueWith(t => _ = t.Exception, CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
        return due
            .Select((t, i) => new ReadyTitle(
                t.Primary.Key,
                t.All.Select(r => r.Request.Id).Where(claimed.Contains).ToList(),
                lookups[i].IsCompletedSuccessfully ? lookups[i].Result : null))
            .ToList();
    }

    public void Delivered(Guid jellyfinUserId, SeerrEndpoint endpoint, IEnumerable<int> requestIds) =>
        _announcements.Delivered(jellyfinUserId, endpoint.BaseUrl.ToString(), requestIds);

    public void GiveBack(Guid jellyfinUserId, SeerrEndpoint endpoint, IEnumerable<int> requestIds) =>
        _announcements.GiveBack(jellyfinUserId, endpoint.BaseUrl.ToString(), requestIds);

    public void Release(Guid jellyfinUserId, SeerrEndpoint endpoint, IEnumerable<int> requestIds) =>
        _announcements.Release(jellyfinUserId, endpoint.BaseUrl.ToString(), requestIds);

    /// <summary>
    /// The card for one requested title, as <paramref name="user"/> sees it (Seerr user <paramref name="seerrUserId"/>,
    /// whose language the title is in), or null if Seerr couldn't give its details. At most <paramref name="gate"/>'s
    /// count at once. Everyone's requests (<see cref="EveryonesRequests"/>) use it too.
    /// </summary>
    internal static async Task<CatalogItemDto?> ResolveAsync(
        ISeerrClient seerr, CatalogMapper mapper, SeerrEndpoint endpoint, int seerrUserId, Tracked tracked, User? user, SemaphoreSlim gate, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        SeerrTitle title;
        try
        {
            title = await seerr.GetTitleSummaryAsync(endpoint, seerrUserId, tracked.MediaType, tracked.Request.Media!.TmdbId, cancellationToken).ConfigureAwait(false);
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
        return mapper.ToItem(tracked.MediaType, card, user, CatalogMapper.TitleGenreNames(title));
    }

    /// <summary>
    /// The user's requested titles with their progress: cached for <see cref="Ttl"/> (a failure for
    /// <see cref="FailureTtl"/>), one Seerr call at a time per user.
    /// </summary>
    internal async Task<IReadOnlyList<TrackedTitle>> GetTrackedAsync(SeerrEndpoint endpoint, int seerrUserId, CancellationToken cancellationToken)
    {
        var key = CacheKey(endpoint, seerrUserId);
        var now = _time.GetUtcNow();
        while (true)
        {
            if (_cache.TryGetValue(key, out var entry) && entry.IsFresh(now))
            {
                // A failure is kept too (every caller meanwhile gets it), so one user's devices and tabs can't keep
                // Seerr busy with a call that fails.
                return await entry.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
            }

            if (_cache.Count >= MaxCached)
            {
                _cache.Clear();
            }

            // Not tied to this caller's cancellation: others may be waiting on it (Seerr calls time out on their own).
            var fresh = new SharedAnswer<IReadOnlyList<TrackedTitle>>(now, Ttl, FailureTtl);
            if (entry is null ? _cache.TryAdd(key, fresh) : _cache.TryUpdate(key, fresh, entry))
            {
                fresh.Start(FetchAsync(endpoint, seerrUserId), _time);
            }
        }
    }

    /// <summary>
    /// The requests in flight that have only been waiting, for an approval or for a release to download, since over
    /// <see cref="WaitingAfter"/> ago. One that's downloading or being imported never counts.
    /// </summary>
    private IEnumerable<int> Waiting(List<Tracked> tracked)
    {
        var before = _time.GetUtcNow() - WaitingAfter;
        return tracked
            .Where(t => t.Progress.State is RequestProgressState.Requested or RequestProgressState.Queued && t.Request.CreatedAt < before)
            .Select(t => t.Request.Id);
    }

    private (string Endpoint, int User, int ConfigVersion) CacheKey(SeerrEndpoint endpoint, int seerrUserId) =>
        (endpoint.CacheKey, seerrUserId, _config.Current.ConfigVersion);

    private async Task<IReadOnlyList<TrackedTitle>> FetchAsync(SeerrEndpoint endpoint, int seerrUserId)
    {
        var requests = await _seerr.GetUserRequestsAsync(endpoint, seerrUserId, CancellationToken.None, Take).ConfigureAwait(false);
        var now = _time.GetUtcNow();

        // Requests for a title Seerr can describe; not those it calls Completed because the title was removed.
        var valid = requests
            .Select(r => (Request: r, MediaType: r.Type ?? r.Media?.MediaType))
            .Where(r => r.Request.Media is { TmdbId: > 0 } && CatalogMediaType.IsValid(r.MediaType) && !RequestProgress.IsRemoved(r.Request))
            .Select(r => (r.Request, MediaType: r.MediaType!, Key: r.MediaType + "-" + r.Request.Media!.TmdbId.ToString(System.Globalization.CultureInfo.InvariantCulture)))
            .ToList();

        lock (_memoryLock)
        {
            if (_memories.Count >= MaxMemories)
            {
                _memories.Clear();
            }

            // Each title's queue (per quality) once: a show's season requests share it.
            var memories = new Dictionary<(string Key, bool Is4k), DownloadMemory?>();
            foreach (var queue in valid.GroupBy(v => (v.Key, v.Request.Is4k)))
            {
                var downloads = RequestProgress.Downloads(queue.First().Request);
                var memoryKey = (endpoint.CacheKey, seerrUserId, queue.Key.Key, queue.Key.Is4k);
                _memories.TryGetValue(memoryKey, out var memory);
                if (downloads.Count > 0)
                {
                    memory ??= _memories[memoryKey] = new DownloadMemory();
                }

                memory?.Observe(downloads, now);
                memories[queue.Key] = memory;
            }

            var tracked = valid.Select(v => new Tracked(v.Key, v.MediaType, v.Request, RequestProgress.Map(v.Request, now, memories[(v.Key, v.Request.Is4k)]))).ToList();

            // A title's queue with nothing in flight any more is forgotten.
            foreach (var (key, is4k) in memories.Keys)
            {
                if (!tracked.Any(t => t.Key == key && t.Request.Is4k == is4k && RequestProgressState.IsInFlight(t.Progress.State)))
                {
                    _memories.Remove((endpoint.CacheKey, seerrUserId, key, is4k));
                }
            }

            // One entry per title (a show's seasons are often separate requests): the request furthest along of those in
            // flight (a season downloading beats one waiting for approval), else the newest. A show with several season
            // requests in flight shows the progress of all of them.
            return tracked
                .GroupBy(t => t.Key)
                .Select(g =>
                {
                    var all = g.ToList();
                    var primary = all.OrderByDescending(t => RequestProgressState.InFlightRank(t.Progress.State)).ThenByDescending(t => t.Request.Id).First();
                    var together = all.Where(t => t.Request.Is4k == primary.Request.Is4k && RequestProgressState.IsInFlight(t.Progress.State)).ToList();
                    var shown = primary.Progress;
                    if (together.Count > 1 && together.All(t => RequestProgress.SeasonsOf(t.Request) is not null))
                    {
                        var seasons = together.SelectMany(t => RequestProgress.SeasonsOf(t.Request)!).ToHashSet();
                        shown = RequestProgress.Map(primary.Request, now, memories[(primary.Key, primary.Request.Is4k)], seasons);
                    }

                    return new TrackedTitle(primary, all, shown);
                })
                .OrderByDescending(t => t.All.Max(r => r.Request.CreatedAt ?? DateTimeOffset.MinValue))
                .ThenByDescending(t => t.All.Max(r => r.Request.Id))
                .ToList();
        }
    }

    /// <summary>One of the user's requests, its title's key ("movie-603") and its progress when Seerr answered.</summary>
    internal sealed record Tracked(string Key, string MediaType, SeerrUserRequest Request, RequestProgressInfo Progress);

    /// <summary>A requested title: the request it shows (<see cref="Primary"/>), all of the user's for it, and its progress.</summary>
    internal sealed record TrackedTitle(Tracked Primary, IReadOnlyList<Tracked> All, RequestProgressInfo Shown);
}
