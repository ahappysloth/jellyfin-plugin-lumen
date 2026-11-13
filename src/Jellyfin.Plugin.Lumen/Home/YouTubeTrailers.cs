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
}

/// <summary>
/// <see cref="IYouTubeTrailers"/>, while "Use YouTube trailers" is on. It reads the item's own metadata first
/// (<see cref="BaseItem.RemoteTrailers"/>, which Jellyfin fills from TMDB, so no Seerr is needed), then asks Seerr for the
/// title's videos if it's set up and the item has a TMDB id. Seerr's answer is kept for <see cref="HitTtl"/> (no trailer:
/// <see cref="MissTtl"/>, in case one is published), for everyone: the home hero asks for every slide on every build, and a
/// video id is no secret. Only who may ask Seerr is per user: the call acts as the user, as every catalog call does, so a
/// user without a Seerr account gets what's cached and the item's own metadata.
/// </summary>
public sealed class YouTubeTrailers : IYouTubeTrailers
{
    public const int Capacity = 2000;
    public static readonly TimeSpan HitTtl = TimeSpan.FromHours(24);
    public static readonly TimeSpan MissTtl = TimeSpan.FromHours(1);

    private readonly Lock _lock = new();
    private readonly Dictionary<(string Endpoint, string MediaType, int TmdbId), Entry> _cache = [];
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

        if (FromMetadata(item) is { } own)
        {
            return own;
        }

        var mediaType = item switch
        {
            Movie => CatalogMediaType.Movie,
            Series => CatalogMediaType.Tv,
            _ => null,
        };
        if (mediaType is null
            || SeerrEndpoint.From(config) is not { } configured
            || !int.TryParse(item.GetProviderId(MetadataProvider.Tmdb), NumberStyles.None, CultureInfo.InvariantCulture, out var tmdbId)
            || tmdbId <= 0)
        {
            return null;
        }

        if (TryGetCached((configured.CacheKey, mediaType, tmdbId), out var cached))
        {
            return cached;
        }

        // As the user, like every catalog call (their Seerr language picks the trailer). The access carries the endpoint
        // the user id belongs to.
        var access = await _users.GetAccessAsync(user.Id, cancellationToken).ConfigureAwait(false);
        if (!access.Enabled || access.SeerrUserId is not { } seerrUserId || access.Endpoint is not { } endpoint)
        {
            return null;
        }

        var key = (endpoint.CacheKey, mediaType, tmdbId);
        try
        {
            var title = await _seerr.GetTitleSummaryAsync(endpoint, seerrUserId, mediaType, tmdbId, cancellationToken).ConfigureAwait(false);
            var found = FromSeerr(title.RelatedVideos);
            Store(key, found);
            return found;
        }
        catch (SeerrException e) when (e.Status == HttpStatusCode.NotFound)
        {
            // Seerr (TMDB) doesn't know the title: nothing to ask again for a while.
            Store(key, null);
            return null;
        }
        catch (SeerrException e)
        {
            // Not kept: Seerr is asked again next time (its circuit breaker spares it while it's down, and logs that).
            if (!e.IsCircuitOpen && _logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug("Lumen couldn't ask Seerr for a trailer: {Message}", e.Message);
            }

            return null;
        }
    }

    private bool TryGetCached((string Endpoint, string MediaType, int TmdbId) key, out string? id)
    {
        lock (_lock)
        {
            if (_cache.TryGetValue(key, out var entry) && entry.Expires > _time.GetUtcNow())
            {
                id = entry.Id;
                return true;
            }
        }

        id = null;
        return false;
    }

    private void Store((string Endpoint, string MediaType, int TmdbId) key, string? id)
    {
        lock (_lock)
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

            _cache[key] = new Entry(id, now + (id is null ? MissTtl : HitTtl), ++_sequence);
        }
    }

    private sealed record Entry(string? Id, DateTimeOffset Expires, long Sequence);
}
