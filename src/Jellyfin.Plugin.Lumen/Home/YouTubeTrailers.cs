using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Net;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Finds a title's trailer on YouTube, for the muted previews of titles without a local trailer.</summary>
public interface IYouTubeTrailers
{
    /// <summary>
    /// The YouTube video id of <paramref name="item"/>'s trailer, or null: the setting is off, the item has none, or
    /// Seerr couldn't be asked. Never throws for a Seerr failure. Callers check for a local trailer first: that one wins.
    /// </summary>
    Task<string?> GetAsync(BaseItem item, User user, CancellationToken cancellationToken);

    /// <summary>
    /// For a title's Media info: where <see cref="GetAsync"/> finds the trailer, and how asking Seerr went (from the cache
    /// it shares, or asked now); with <paramref name="refresh"/>, Seerr is asked again past that cache. Callers check the
    /// setting. Never throws for a Seerr failure.
    /// </summary>
    Task<YouTubeDiagnosis> DiagnoseAsync(BaseItem item, User user, bool refresh, CancellationToken cancellationToken);
}

/// <summary>
/// <see cref="IYouTubeTrailers"/>, while "Use YouTube trailers" is on. It reads the item's own metadata first
/// (<see cref="BaseItem.RemoteTrailers"/>, which Jellyfin fills from TMDB, so no Seerr is needed), then asks Seerr for the
/// title's videos if it's set up and the item has a TMDB id. Seerr's answer is kept for <see cref="HitTtl"/> (no trailer:
/// <see cref="MissTtl"/>, in case one is published; Seerr failing: <see cref="FailureTtl"/>), for everyone: the home hero
/// asks for every slide on every build, and a video id is no secret. One title is asked for once at a time: whoever asks
/// while that's under way waits for the same answer. Only who may ask Seerr is per user: the call acts as the user, as
/// every catalog call does, so a user without a Seerr account gets what's cached and the item's own metadata.
/// </summary>
public sealed class YouTubeTrailers : IYouTubeTrailers
{
    public const int Capacity = 2000;
    public static readonly TimeSpan HitTtl = TimeSpan.FromHours(24);
    public static readonly TimeSpan MissTtl = TimeSpan.FromHours(1);

    /// <summary>
    /// Seerr down, slow or refusing: no trailer for this long. Without it every home build would ask again for every slide
    /// (a stalled Seerr times out only after the hero has stopped waiting), until the circuit breaker opens.
    /// </summary>
    public static readonly TimeSpan FailureTtl = TimeSpan.FromMinutes(5);

    private readonly Lock _lock = new();
    private readonly Dictionary<(string Endpoint, string MediaType, int TmdbId), Entry> _cache = [];
    private readonly Dictionary<(string Endpoint, string MediaType, int TmdbId), Task<Entry>> _asking = [];
    private readonly ILumenConfigReader _config;
    private readonly ISeerrClient _seerr;
    private readonly ISeerrUserMap _users;
    private readonly TimeProvider _time;
    private readonly ILogger<YouTubeTrailers> _logger;
    private long _sequence;

    public YouTubeTrailers(ILumenConfigReader config, ISeerrClient seerr, ISeerrUserMap users, TimeProvider time, ILogger<YouTubeTrailers> logger)
    {
        _config = config;
        _seerr = seerr;
        _users = users;
        _time = time;
        _logger = logger;
    }

    internal int CachedCount
    {
        get
        {
            lock (_lock)
            {
                return _cache.Count;
            }
        }
    }

    /// <summary>The first of the item's own trailer links that is a YouTube video.</summary>
    public static string? FromMetadata(BaseItem item) =>
        (item.RemoteTrailers ?? []).Select(t => YouTubeId.FromUrl(t.Url)).FirstOrDefault(id => id is not null);

    /// <summary>
    /// Seerr's pick: its first YouTube video of type "Trailer", else its first "Teaser" (TMDB lists a title's videos in
    /// the user's language first). Clips, featurettes and other sites' videos are never a preview.
    /// </summary>
    public static string? FromSeerr(IReadOnlyList<SeerrVideo>? videos)
    {
        var youTube = (videos ?? []).Where(v => string.Equals(v.Site, "YouTube", StringComparison.OrdinalIgnoreCase) && YouTubeId.IsValid(v.Key)).ToList();
        return (youTube.FirstOrDefault(v => string.Equals(v.Type, "Trailer", StringComparison.OrdinalIgnoreCase))
            ?? youTube.FirstOrDefault(v => string.Equals(v.Type, "Teaser", StringComparison.OrdinalIgnoreCase)))?.Key;
    }

    public async Task<string?> GetAsync(BaseItem item, User user, CancellationToken cancellationToken)
    {
        var config = _config.Current;
        if (!config.Enabled || !config.TrailerPreview || !config.YouTubeTrailers)
        {
            return null;
        }

        return (await LookUpAsync(item, user, false, cancellationToken).ConfigureAwait(false)).VideoId;
    }

    public Task<YouTubeDiagnosis> DiagnoseAsync(BaseItem item, User user, bool refresh, CancellationToken cancellationToken) =>
        LookUpAsync(item, user, refresh, cancellationToken);

    private static YouTubeDiagnosis Without(string status, string? detail) => new(null, null, new TrailerOutcome(status, detail, null), false);

    private static YouTubeDiagnosis FromEntry(Entry entry, bool cached) =>
        new(entry.Id, entry.Id is null ? null : TrailerSource.Seerr, entry.Outcome, cached);

    /// <summary>A few words on why Seerr couldn't be asked, for a title's Media info: never its address or key.</summary>
    private static string Describe(Exception e) => e switch
    {
        SeerrException { IsCircuitOpen: true } => "Seerr paused after failures",
        SeerrException { Status: { } status } => string.Create(CultureInfo.InvariantCulture, $"Seerr answered HTTP {(int)status}"),
        SeerrException { InnerException: OperationCanceledException } => "Seerr didn't answer in time",
        SeerrException { InnerException: HttpRequestException } => "couldn't reach Seerr",
        _ => "Seerr failed",
    };

    private async Task<YouTubeDiagnosis> LookUpAsync(BaseItem item, User user, bool refresh, CancellationToken cancellationToken)
    {
        if (FromMetadata(item) is { } own)
        {
            return new YouTubeDiagnosis(own, TrailerSource.Jellyfin, new TrailerOutcome(TrailerStatus.Found, null, null), false);
        }

        var config = _config.Current;
        var mediaType = item switch
        {
            Movie => CatalogMediaType.Movie,
            Series => CatalogMediaType.Tv,
            _ => null,
        };
        if (mediaType is null)
        {
            return Without(TrailerStatus.NotFound, null);
        }

        if (SeerrEndpoint.From(config) is not { } configured)
        {
            return Without(TrailerStatus.NoSeerr, "Seerr isn't set up");
        }

        if (!int.TryParse(item.GetProviderId(MetadataProvider.Tmdb), NumberStyles.None, CultureInfo.InvariantCulture, out var tmdbId) || tmdbId <= 0)
        {
            return Without(TrailerStatus.NoId, null);
        }

        if (!refresh && TryGetCached((configured.CacheKey, mediaType, tmdbId), out var cached))
        {
            return FromEntry(cached, true);
        }

        // As the user, like every catalog call (their Seerr language picks the trailer). The access carries the endpoint
        // the user id belongs to.
        var access = await _users.GetAccessAsync(user.Id, cancellationToken).ConfigureAwait(false);
        if (!access.Enabled || access.SeerrUserId is not { } seerrUserId || access.Endpoint is not { } endpoint)
        {
            return Without(TrailerStatus.NoSeerr, "no Seerr access for this user");
        }

        var key = (endpoint.CacheKey, mediaType, tmdbId);
        TaskCompletionSource<Entry>? mine = null;
        Task<Entry> answer;
        lock (_lock)
        {
            if (!_asking.TryGetValue(key, out var asking))
            {
                if (refresh)
                {
                    _cache.Remove(key);
                }
                else if (TryGetCachedLocked(key, out cached))
                {
                    return FromEntry(cached, true);
                }

                mine = new TaskCompletionSource<Entry>(TaskCreationOptions.RunContinuationsAsynchronously);
                asking = mine.Task;
                _asking[key] = asking;
            }

            answer = asking;
        }

        if (mine is not null)
        {
            // Not cancelled with this caller: others may be waiting for it, and the answer is cached for the next.
            _ = AskSeerrAsync(mine, key, endpoint, seerrUserId, mediaType, tmdbId);
        }

        return FromEntry(await answer.WaitAsync(cancellationToken).ConfigureAwait(false), false);
    }

    private async Task AskSeerrAsync(
        TaskCompletionSource<Entry> answer,
        (string Endpoint, string MediaType, int TmdbId) key,
        SeerrEndpoint endpoint,
        int seerrUserId,
        string mediaType,
        int tmdbId)
    {
        string? found = null;
        var ttl = FailureTtl;
        var asked = _time.GetUtcNow();
        TrailerOutcome outcome;
        try
        {
            var title = await _seerr.GetTitleSummaryAsync(endpoint, seerrUserId, mediaType, tmdbId, CancellationToken.None).ConfigureAwait(false);
            found = FromSeerr(title.RelatedVideos);
            ttl = found is null ? MissTtl : HitTtl;
            outcome = new TrailerOutcome(found is null ? TrailerStatus.NotFound : TrailerStatus.Found, null, asked);
        }
        catch (SeerrException e) when (e.Status == HttpStatusCode.NotFound)
        {
            // Seerr (TMDB) doesn't know the title: nothing to ask again for a while.
            ttl = MissTtl;
            outcome = new TrailerOutcome(TrailerStatus.NotFound, "Seerr doesn't know the title", asked);
        }
        catch (Exception e)
        {
            // Asked again after FailureTtl (the circuit breaker spares Seerr meanwhile, and logs that it's down).
            if (!(e is SeerrException { IsCircuitOpen: true }) && _logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug("Lumen couldn't ask Seerr for a trailer: {Message}", e.Message);
            }

            outcome = new TrailerOutcome(TrailerStatus.Error, Describe(e), asked);
        }

        Entry entry;
        lock (_lock)
        {
            entry = StoreLocked(key, found, ttl, outcome);
            _asking.Remove(key);
        }

        answer.SetResult(entry);
    }

    private bool TryGetCached((string Endpoint, string MediaType, int TmdbId) key, [MaybeNullWhen(false)] out Entry entry)
    {
        lock (_lock)
        {
            return TryGetCachedLocked(key, out entry);
        }
    }

    private bool TryGetCachedLocked((string Endpoint, string MediaType, int TmdbId) key, [MaybeNullWhen(false)] out Entry entry)
    {
        if (_cache.TryGetValue(key, out var found) && found.Expires > _time.GetUtcNow())
        {
            entry = found;
            return true;
        }

        entry = null;
        return false;
    }

    private Entry StoreLocked((string Endpoint, string MediaType, int TmdbId) key, string? id, TimeSpan ttl, TrailerOutcome outcome)
    {
        var now = _time.GetUtcNow();
        _cache.Remove(key);
        if (_cache.Count >= Capacity)
        {
            foreach (var expired in _cache.Where(e => e.Value.Expires <= now).Select(e => e.Key).ToList())
            {
                _cache.Remove(expired);
            }
        }

        while (_cache.Count >= Capacity)
        {
            _cache.Remove(_cache.MinBy(e => e.Value.Sequence).Key);
        }

        var entry = new Entry(id, now + ttl, ++_sequence, outcome);
        _cache[key] = entry;
        return entry;
    }

    /// <summary>A cached answer: the video id (null for none), until when, and how asking went.</summary>
    private sealed record Entry(string? Id, DateTimeOffset Expires, long Sequence, TrailerOutcome Outcome);
}
