namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>
/// A title from Seerr's catalog that the server may or may not have (requests design spec, §3). <c>Poster</c> and
/// <c>Backdrop</c> are TMDB file names (no leading slash) for <c>/Lumen/Requests/Image/{size}/{file}</c>.
/// <c>JellyfinItemId</c> ("N" format) is set only when the title is available and this user can see the item.
/// </summary>
public record CatalogItemDto(
    string Key,
    string MediaType,
    int TmdbId,
    string Title,
    int? Year,
    string? Overview,
    double? Rating,
    IReadOnlyList<string> GenreNames,
    string? Poster,
    string? Backdrop,
    string State,
    string? JellyfinItemId);

/// <summary>Response of GET /Lumen/Requests/Title/{mediaType}/{tmdbId}: the item plus details for the title page.</summary>
public sealed record CatalogTitleDto : CatalogItemDto
{
    public CatalogTitleDto(CatalogItemDto item)
        : base(item)
    {
    }

    /// <summary>Runtime in minutes (movies).</summary>
    public int? Runtime { get; init; }

    /// <summary>A YouTube watch URL, opened in a new tab by the client.</summary>
    public string? TrailerUrl { get; init; }

    public IReadOnlyList<CatalogCastDto> Cast { get; init; } = [];

    /// <summary>TV only (empty for movies): seasons 1+ in ascending order, each with its own state.</summary>
    public IReadOnlyList<CatalogSeasonDto> Seasons { get; init; } = [];

    public IReadOnlyList<CatalogItemDto> Recommendations { get; init; } = [];

    /// <summary>Whether to offer a Request button: the user may request this media type and something is left to request.</summary>
    public bool CanRequest { get; init; }
}

/// <summary>A cast member. <c>Photo</c> is a TMDB file name, like <see cref="CatalogItemDto.Poster"/>.</summary>
public sealed record CatalogCastDto(int TmdbId, string Name, string? Character, string? Photo);

/// <summary>A season of a catalog show.</summary>
public sealed record CatalogSeasonDto(int Number, string Name, int EpisodeCount, string State);

/// <summary>Response of GET /Lumen/Requests/Search.</summary>
public sealed record CatalogSearchDto(IReadOnlyList<CatalogItemDto> Results, int Page, int TotalPages);

/// <summary>Body of POST /Lumen/Requests. For TV, null or empty <c>Seasons</c> requests all seasons.</summary>
public sealed record CatalogRequestDto(string? MediaType, int TmdbId, IReadOnlyList<int>? Seasons);

/// <summary>Response of POST /Lumen/Requests.</summary>
public sealed record RequestResultDto(string State, bool NeedsApproval);

/// <summary>An error message to show the user.</summary>
public sealed record ErrorDto(string Error);
