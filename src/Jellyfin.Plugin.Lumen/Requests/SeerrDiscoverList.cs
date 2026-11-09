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
