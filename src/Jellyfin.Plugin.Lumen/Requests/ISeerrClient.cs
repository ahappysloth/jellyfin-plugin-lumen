namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Typed access to the Seerr endpoints Lumen uses (see the requests design spec, §4).</summary>
public interface ISeerrClient
{
    Task<SeerrStatus> GetStatusAsync(SeerrEndpoint endpoint, CancellationToken cancellationToken);

    /// <summary>The Jellyfin server Seerr is linked to, or null if it isn't set up for Jellyfin.</summary>
    Task<SeerrJellyfinServer?> GetJellyfinServerAsync(SeerrEndpoint endpoint, CancellationToken cancellationToken);

    /// <summary>The Seerr account linked to a Jellyfin user, or null if there is none. Goes through the circuit breaker.</summary>
    Task<SeerrUser?> GetUserByJellyfinIdAsync(SeerrEndpoint endpoint, Guid jellyfinUserId, CancellationToken cancellationToken);

    /// <summary>
    /// <see cref="GetUserByJellyfinIdAsync"/> for the admin page: bypasses the circuit breaker, so Test connection and the
    /// users list always really try, and their failures never pause request features for everyone.
    /// </summary>
    Task<SeerrUser?> GetUserByJellyfinIdForAdminAsync(SeerrEndpoint endpoint, Guid jellyfinUserId, CancellationToken cancellationToken);

    /// <summary>Movies, shows and people matching <paramref name="query"/>, as the Seerr user <paramref name="seerrUserId"/>.</summary>
    Task<SeerrPage> SearchAsync(SeerrEndpoint endpoint, int seerrUserId, string query, int page, CancellationToken cancellationToken);

    /// <summary>A movie's details, as the given Seerr user.</summary>
    Task<SeerrTitle> GetMovieAsync(SeerrEndpoint endpoint, int seerrUserId, int tmdbId, CancellationToken cancellationToken);

    /// <summary>A show's details, as the given Seerr user.</summary>
    Task<SeerrTitle> GetTvAsync(SeerrEndpoint endpoint, int seerrUserId, int tmdbId, CancellationToken cancellationToken);

    /// <summary>The first page of recommendations for a title (<paramref name="mediaType"/> is "movie" or "tv").</summary>
    Task<SeerrPage> GetRecommendationsAsync(SeerrEndpoint endpoint, int seerrUserId, string mediaType, int tmdbId, CancellationToken cancellationToken);

    /// <summary>
    /// Files a request as the given Seerr user, so Seerr applies their permissions, quota and auto-approval. For TV, a
    /// null or empty <paramref name="seasons"/> requests all seasons; it is ignored for movies.
    /// </summary>
    Task<SeerrRequestResult> CreateRequestAsync(SeerrEndpoint endpoint, int seerrUserId, string mediaType, int tmdbId, IReadOnlyList<int>? seasons, CancellationToken cancellationToken);

    /// <summary>
    /// The first page of a discover list, cached for 10 minutes and shared with users whose Seerr language and region
    /// settings are the same (see <see cref="SeerrClient"/>).
    /// </summary>
    Task<SeerrPage> DiscoverAsync(SeerrEndpoint endpoint, int seerrUserId, SeerrDiscoverList list, CancellationToken cancellationToken);

    /// <summary>The user's 20 most recent requests, newest first (no title or art; see <see cref="GetTitleSummaryAsync"/>).</summary>
    Task<IReadOnlyList<SeerrUserRequest>> GetUserRequestsAsync(SeerrEndpoint endpoint, int seerrUserId, CancellationToken cancellationToken);

    /// <summary>
    /// A title's details for a card (title, year, art, rating, genres), cached for 10 minutes per title and shared like
    /// <see cref="DiscoverAsync"/>. Its <c>MediaInfo</c> may be stale, so never read the request state from it.
    /// </summary>
    Task<SeerrTitle> GetTitleSummaryAsync(SeerrEndpoint endpoint, int seerrUserId, string mediaType, int tmdbId, CancellationToken cancellationToken);
}
