namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Seerr's version, from <c>GET /api/v1/status</c>.</summary>
public sealed record SeerrStatus(string Version);

/// <summary>
/// The Jellyfin server Seerr is linked to. Seerr's settings response also contains its Jellyfin API key, so only the
/// name and server id are kept.
/// </summary>
public sealed record SeerrJellyfinServer(string Name, string ServerId)
{
    /// <summary>True when <paramref name="systemId"/> (this server's id) is the server Seerr is linked to.</summary>
    public bool Is(string systemId) => Normalize(ServerId) == Normalize(systemId);

    private static string Normalize(string id) => id.Replace("-", string.Empty, StringComparison.Ordinal).ToUpperInvariant();
}

/// <summary>How many Radarr and Sonarr servers Seerr has (only the counts: their settings hold those apps' API keys).</summary>
public sealed record SeerrServices(int Radarr, int Sonarr);

/// <summary>
/// The only parts of a Seerr user Lumen keeps. Seerr's user object (fetched with the admin key) also carries the user's
/// Jellyfin and Plex tokens, so it is never stored or passed on whole.
/// </summary>
public sealed record SeerrUser(int Id, long Permissions);

/// <summary>
/// A page of Seerr results (<c>/search</c>, <c>/movie/{id}/recommendations</c>, ...). Only the fields Lumen reads are
/// declared; the rest of Seerr's response is ignored.
/// </summary>
public sealed class SeerrPage
{
    public int Page { get; init; }

    public int TotalPages { get; init; }

    public IReadOnlyList<SeerrMedia>? Results { get; init; }
}

/// <summary>A movie, show, or person in a Seerr result list (fields shared with the details responses).</summary>
public class SeerrMedia
{
    /// <summary>"movie", "tv" or "person". Absent on details responses.</summary>
    public string? MediaType { get; init; }

    /// <summary>The TMDB id.</summary>
    public int Id { get; init; }

    /// <summary>Movie title.</summary>
    public string? Title { get; init; }

    /// <summary>Show title.</summary>
    public string? Name { get; init; }

    /// <summary>Movie release date, "YYYY-MM-DD" or empty.</summary>
    public string? ReleaseDate { get; init; }

    /// <summary>Show first air date, "YYYY-MM-DD" or empty.</summary>
    public string? FirstAirDate { get; init; }

    public string? Overview { get; init; }

    public string? PosterPath { get; init; }

    public string? BackdropPath { get; init; }

    public double? VoteAverage { get; init; }

    public IReadOnlyList<int>? GenreIds { get; init; }

    public SeerrMediaInfo? MediaInfo { get; init; }
}

/// <summary>Seerr's <c>GET /movie/{id}</c> or <c>GET /tv/{id}</c>.</summary>
public sealed class SeerrTitle : SeerrMedia
{
    /// <summary>Runtime in minutes (movies).</summary>
    public int? Runtime { get; init; }

    public IReadOnlyList<SeerrGenre>? Genres { get; init; }

    public SeerrCredits? Credits { get; init; }

    public IReadOnlyList<SeerrVideo>? RelatedVideos { get; init; }

    /// <summary>The show's seasons (TV only).</summary>
    public IReadOnlyList<SeerrSeason>? Seasons { get; init; }
}

/// <summary>Seerr's record of a title: availability, the linked Jellyfin item, per-season state and requests.</summary>
public sealed class SeerrMediaInfo
{
    /// <summary>Seerr's MediaStatus (1 Unknown … 7 Deleted).</summary>
    public int? Status { get; init; }

    public string? JellyfinMediaId { get; init; }

    public IReadOnlyList<SeerrSeasonStatus>? Seasons { get; init; }

    public IReadOnlyList<SeerrMediaRequest>? Requests { get; init; }
}

/// <summary>A season number with a status (a MediaStatus in <c>mediaInfo.seasons</c>, a request status in requests).</summary>
public sealed class SeerrSeasonStatus
{
    public int SeasonNumber { get; init; }

    public int? Status { get; init; }
}

/// <summary>A request for a title; <see cref="Status"/> is a <see cref="SeerrRequestStatus"/>.</summary>
public sealed class SeerrMediaRequest
{
    public int? Status { get; init; }

    public IReadOnlyList<SeerrSeasonStatus>? Seasons { get; init; }
}

public sealed class SeerrGenre
{
    public int Id { get; init; }

    public string? Name { get; init; }
}

public sealed class SeerrCredits
{
    public IReadOnlyList<SeerrCastMember>? Cast { get; init; }
}

public sealed class SeerrCastMember
{
    public int Id { get; init; }

    public string? Name { get; init; }

    public string? Character { get; init; }

    public string? ProfilePath { get; init; }
}

public sealed class SeerrVideo
{
    public string? Key { get; init; }

    public string? Type { get; init; }

    public string? Site { get; init; }
}

public sealed class SeerrSeason
{
    public int SeasonNumber { get; init; }

    public string? Name { get; init; }

    public int EpisodeCount { get; init; }
}

/// <summary>Seerr's answer to <c>POST /request</c>: the request's status (1 = needs approval) and the title's MediaStatus.</summary>
public sealed record SeerrRequestResult(int Id, int? RequestStatus, int? MediaStatus);

/// <summary>A page of <c>GET /user/{id}/requests</c>. These results carry no title or art.</summary>
public sealed class SeerrUserRequestPage
{
    public IReadOnlyList<SeerrUserRequest>? Results { get; init; }
}

/// <summary>One of a user's requests; <see cref="Status"/> is a <see cref="SeerrRequestStatus"/>.</summary>
public sealed class SeerrUserRequest
{
    public int Id { get; init; }

    public int? Status { get; init; }

    public DateTimeOffset? CreatedAt { get; init; }

    /// <summary>"movie" or "tv".</summary>
    public string? Type { get; init; }

    /// <summary>A 4K request: its download is in the media's <see cref="SeerrRequestMedia.DownloadStatus4k"/>.</summary>
    public bool Is4k { get; init; }

    /// <summary>The requested seasons (TV), each with a request status (5 = completed: that season is available).</summary>
    public IReadOnlyList<SeerrSeasonStatus>? Seasons { get; init; }

    public SeerrRequestMedia? Media { get; init; }
}

/// <summary>The title a request is for: its TMDB id, MediaStatus and linked Jellyfin item.</summary>
public sealed class SeerrRequestMedia
{
    public int TmdbId { get; init; }

    public string? MediaType { get; init; }

    /// <summary>Seerr's MediaStatus (1 Unknown … 7 Deleted).</summary>
    public int? Status { get; init; }

    /// <summary>
    /// The same for the title's 4K copy: Seerr keeps both on one media row (<c>status</c> and <c>status4k</c> in its
    /// <c>server/entity/Media.ts</c>), so HD on the server says nothing about a 4K request.
    /// </summary>
    public int? Status4k { get; init; }

    public string? JellyfinMediaId { get; init; }

    /// <summary>
    /// The title's entries in Radarr's or Sonarr's download queue, as Seerr last saw them (its download sync runs every
    /// minute). Empty when nothing is downloading, or when Seerr isn't connected to Radarr/Sonarr.
    /// </summary>
    public IReadOnlyList<SeerrDownload>? DownloadStatus { get; init; }

    /// <summary>The same for the title's 4K server.</summary>
    public IReadOnlyList<SeerrDownload>? DownloadStatus4k { get; init; }
}

/// <summary>
/// One entry of Radarr's or Sonarr's download queue, as Seerr passes it on (<c>DownloadingItem</c> in Seerr's
/// <c>server/lib/downloadtracker.ts</c>). Sonarr lists a season pack once per episode, each with the whole pack's
/// <see cref="Size"/> and <see cref="SizeLeft"/> and the same <see cref="DownloadId"/>.
/// </summary>
public sealed class SeerrDownload
{
    /// <summary>Bytes in the download.</summary>
    public double Size { get; init; }

    /// <summary>Bytes still to download.</summary>
    public double SizeLeft { get; init; }

    /// <summary>
    /// The queue's status: queued, paused, downloading, completed (waiting to be imported), failed, warning or delay.
    /// "failed" is this release, not the request: Radarr and Sonarr blocklist it and look for another.
    /// </summary>
    public string? Status { get; init; }

    /// <summary>When the download client expects it to finish; null (or long past) when it doesn't know.</summary>
    public DateTimeOffset? EstimatedCompletionTime { get; init; }

    public string? DownloadId { get; init; }

    /// <summary>The release's name, which identifies a download when the download client gave no id.</summary>
    public string? Title { get; init; }

    /// <summary>The episode this entry is for (Sonarr only).</summary>
    public SeerrEpisode? Episode { get; init; }
}

/// <summary>A queued episode's place in its show.</summary>
public sealed class SeerrEpisode
{
    public int SeasonNumber { get; init; }

    public int EpisodeNumber { get; init; }
}
