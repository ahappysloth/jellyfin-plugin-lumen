namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>The discover lists Lumen shows as home rows (Seerr's <c>/discover/*</c> endpoints).</summary>
public enum SeerrDiscoverList
{
    /// <summary><c>/discover/trending</c>: movies, shows and people.</summary>
    Trending,

    /// <summary><c>/discover/movies</c>.</summary>
    PopularMovies,

    /// <summary><c>/discover/tv</c>.</summary>
    PopularTv,

    /// <summary><c>/discover/movies/upcoming</c>.</summary>
    UpcomingMovies,

    /// <summary><c>/discover/tv/upcoming</c>.</summary>
    UpcomingTv,
}

/// <summary>The media types the catalog handles (Seerr's own names).</summary>
public static class CatalogMediaType
{
    public const string Movie = "movie";
    public const string Tv = "tv";

    public static bool IsValid(string? mediaType) => mediaType is Movie or Tv;
}

/// <summary>
/// A page of Seerr results (<c>/search</c>, <c>/movie/{id}/recommendations</c>, ...). Only the fields Lumen reads are
/// declared; the rest of Seerr's response is ignored.
/// </summary>
public sealed class SeerrPage
{
    public int Page { get; init; }

    public int TotalPages { get; init; }

    public int TotalResults { get; init; }

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

/// <summary>A request for a title. Status 1 pending, 2 approved, 3 declined.</summary>
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
    public string? Url { get; init; }

    public string? Key { get; init; }

    public string? Name { get; init; }

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

/// <summary>One of a user's requests. Status 1 pending, 2 approved, 3 declined.</summary>
public sealed class SeerrUserRequest
{
    public int Id { get; init; }

    public int? Status { get; init; }

    public DateTimeOffset? CreatedAt { get; init; }

    /// <summary>"movie" or "tv".</summary>
    public string? Type { get; init; }

    public SeerrRequestMedia? Media { get; init; }
}

/// <summary>The title a request is for: its TMDB id, MediaStatus and linked Jellyfin item.</summary>
public sealed class SeerrRequestMedia
{
    public int TmdbId { get; init; }

    public string? MediaType { get; init; }

    /// <summary>Seerr's MediaStatus (1 Unknown … 7 Deleted).</summary>
    public int? Status { get; init; }

    public string? JellyfinMediaId { get; init; }
}
