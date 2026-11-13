using System.Collections.Concurrent;
using System.Globalization;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Every user's requests and how each is going, for an administrator's My requests (GET /Lumen/Requests/All).</summary>
public interface IEveryonesRequests
{
    /// <summary>
    /// Every user's most recently requested titles, newest first, with who requested each, as <paramref name="viewer"/>
    /// (Seerr user <paramref name="viewerSeerrUserId"/>) sees the titles. The caller checks they're an administrator.
    /// Throws <see cref="SeerrException"/> when Seerr can't say.
    /// </summary>
    Task<AllRequestsDto> GetAsync(User? viewer, SeerrEndpoint endpoint, int viewerSeerrUserId, CancellationToken cancellationToken);
}

/// <summary>
/// Builds everyone's request list from one Seerr call, <c>GET /request</c> (see <see cref="ISeerrClient.GetAllRequestsAsync"/>),
/// cached for <see cref="RequestProgressService.Ttl"/> and shared by every administrator asking meanwhile (a failure
/// for <see cref="RequestProgressService.FailureTtl"/>), as a user's own list is. Then, as for that list:
/// <list type="bullet">
/// <item>One entry per title and requester: the request furthest along of theirs for it, else the newest.</item>
/// <item>Titles and art from the shared title cache, within <see cref="RequestProgressService.DetailsBudget"/>; one not
/// described in time is left out and the answer says it's <c>Partial</c>, so the page asks again soon.</item>
/// <item>Progress from the request alone: what each user's own list remembers of downloads that left the queue isn't
/// used, so a show part-way through can read lower here than in its requester's list.</item>
/// </list>
/// Nothing here is announced: the "ready" pop-up and notifications are only ever about the user's own requests.
/// </summary>
public sealed class EveryonesRequests : IEveryonesRequests
{
    /// <summary>The most recent requests the list covers: enough for search and filters on a household's or a club's server.</summary>
    public const int Take = 100;

    /// <summary>Longer Seerr names are cut (they're shown in a row).</summary>
    public const int MaxNameLength = 100;

    /// <summary>More endpoints than this cached and the cache starts over.</summary>
    private const int MaxCached = 16;

    private readonly ConcurrentDictionary<(string Endpoint, int ConfigVersion), SharedAnswer<IReadOnlyList<SeerrUserRequest>>> _cache = new();
    private readonly ISeerrClient _seerr;
    private readonly ILumenConfigReader _config;
    private readonly CatalogMapper _mapper;
    private readonly ISeerrUserMap _users;
    private readonly IUserManager _userManager;
    private readonly TimeProvider _time;

    public EveryonesRequests(ISeerrClient seerr, ILumenConfigReader config, CatalogMapper mapper, ISeerrUserMap users, IUserManager userManager, TimeProvider time)
    {
        _seerr = seerr;
        _config = config;
        _mapper = mapper;
        _users = users;
        _userManager = userManager;
        _time = time;
    }

    public async Task<AllRequestsDto> GetAsync(User? viewer, SeerrEndpoint endpoint, int viewerSeerrUserId, CancellationToken cancellationToken)
    {
        var requests = await GetRequestsAsync(endpoint, cancellationToken).ConfigureAwait(false);
        var now = _time.GetUtcNow();

        // Requests for a title Seerr can describe; not those it calls Completed because the title was removed.
        var titles = requests
            .Select(r => (Request: r, MediaType: r.Type ?? r.Media?.MediaType))
            .Where(r => r.Request.Media is { TmdbId: > 0 } && CatalogMediaType.IsValid(r.MediaType) && !RequestProgress.IsRemoved(r.Request))
            .Select(r => new RequestProgressService.Tracked(
                r.MediaType + "-" + r.Request.Media!.TmdbId.ToString(CultureInfo.InvariantCulture),
                r.MediaType!,
                r.Request,
                RequestProgress.Map(r.Request, now)))
            .GroupBy(t => (t.Key, Requester: t.Request.RequestedBy?.Id ?? 0))
            .Select(g =>
            {
                var group = g.ToList();
                var primary = group
                    .OrderByDescending(t => RequestProgressState.InFlightRank(t.Progress.State))
                    .ThenByDescending(t => t.Request.Id)
                    .First();
                return (Primary: primary, All: group);
            })
            .OrderByDescending(t => t.All.Max(r => r.Request.CreatedAt ?? DateTimeOffset.MinValue))
            .ThenByDescending(t => t.All.Max(r => r.Request.Id))
            .ToList();

        // Not disposed: lookups still running after the budget keep using it (it holds no OS handle).
        var gate = new SemaphoreSlim(RequestProgressService.MaxConcurrentDetails);
        var lookups = titles
            .Select(t => RequestProgressService.ResolveAsync(_seerr, _mapper, endpoint, viewerSeerrUserId, t.Primary, viewer, gate, cancellationToken))
            .ToList();
        var all = Task.WhenAll(lookups);
        await Task.WhenAny(all, Task.Delay(RequestProgressService.DetailsBudget, _time, cancellationToken)).ConfigureAwait(false);
        _ = all.ContinueWith(t => _ = t.Exception, CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);

        var requesters = new Dictionary<int, RequesterDto?>();
        var result = new List<MyRequestDto>(titles.Count);
        var partial = false;
        now = _time.GetUtcNow();
        for (var i = 0; i < titles.Count; i++)
        {
            // Still on its way: the next answer has it (the title cache is warmer by then). One Seerr couldn't describe
            // is left out without asking again: it would be every time.
            if (!lookups[i].IsCompleted)
            {
                partial = true;
                continue;
            }

            if (!lookups[i].IsCompletedSuccessfully || lookups[i].Result is not { } item)
            {
                continue;
            }

            var (primary, group) = titles[i];
            var by = primary.Request.RequestedBy;
            var byId = by?.Id ?? 0;
            if (!requesters.TryGetValue(byId, out var requester))
            {
                requesters[byId] = requester = Requester(endpoint, by);
            }

            var progress = primary.Progress;
            result.Add(new MyRequestDto(
                group.Select(r => r.Request.Id).ToList(),
                item,
                progress.State,
                progress.Percent,
                progress.SecondsLeftAt(now),
                progress.EpisodesDone,
                progress.EpisodesTotal,
                group.Min(r => r.Request.CreatedAt),
                false,
                requester));
        }

        return new AllRequestsDto(result, partial);
    }

    /// <summary>
    /// Who filed a request, as a Jellyfin user where Lumen can tell: the Jellyfin account Seerr imported them from, or
    /// the one Lumen has lately mapped to their Seerr account (Overseerr says nothing of Jellyfin). Else their Seerr name.
    /// </summary>
    internal RequesterDto? Requester(SeerrEndpoint endpoint, SeerrRequester? by)
    {
        if (by is null)
        {
            return null;
        }

        var user = (Guid.TryParse(by.JellyfinUserId, out var id) ? _userManager.GetUserById(id) : null)
            ?? (_users.FindJellyfinUser(endpoint, by.Id) is { } mapped ? _userManager.GetUserById(mapped) : null);
        if (user is not null)
        {
            return new RequesterDto(user.Username, user.Id, _userManager.GetUserDto(user)?.PrimaryImageTag);
        }

        var name = by.DisplayName?.Trim();
        return new RequesterDto(string.IsNullOrEmpty(name) ? null : name.Length > MaxNameLength ? name[..MaxNameLength] : name, null, null);
    }

    /// <summary>Seerr's answer, shared as described above.</summary>
    private async Task<IReadOnlyList<SeerrUserRequest>> GetRequestsAsync(SeerrEndpoint endpoint, CancellationToken cancellationToken)
    {
        var key = (endpoint.CacheKey, _config.Current.ConfigVersion);
        var now = _time.GetUtcNow();
        while (true)
        {
            if (_cache.TryGetValue(key, out var entry) && entry.IsFresh(now))
            {
                return await entry.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
            }

            if (_cache.Count >= MaxCached)
            {
                _cache.Clear();
            }

            // Not tied to this caller's cancellation: others may be waiting on it (Seerr calls time out on their own).
            var fresh = new SharedAnswer<IReadOnlyList<SeerrUserRequest>>(now, RequestProgressService.Ttl, RequestProgressService.FailureTtl);
            if (entry is null ? _cache.TryAdd(key, fresh) : _cache.TryUpdate(key, fresh, entry))
            {
                fresh.Start(_seerr.GetAllRequestsAsync(endpoint, Take, CancellationToken.None), _time);
            }
        }
    }
}
