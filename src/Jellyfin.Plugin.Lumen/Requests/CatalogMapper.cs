using System.Globalization;
using System.Text.RegularExpressions;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>
/// Turns Seerr results into Lumen's catalog DTOs. A title Seerr marks available gets its Jellyfin item id only when
/// the item exists and the user can see it in Jellyfin, so cards never link to something the user can't open.
/// </summary>
public sealed partial class CatalogMapper
{
    public const int MaxCast = 15;
    public const int MaxRecommendations = 12;

    /// <summary>TMDB's movie and TV genre ids (public and stable; ids shared by both lists have the same name).</summary>
    private static readonly Dictionary<int, string> GenreTable = new()
    {
        [28] = "Action",
        [12] = "Adventure",
        [16] = "Animation",
        [35] = "Comedy",
        [80] = "Crime",
        [99] = "Documentary",
        [18] = "Drama",
        [10751] = "Family",
        [14] = "Fantasy",
        [36] = "History",
        [27] = "Horror",
        [10402] = "Music",
        [9648] = "Mystery",
        [10749] = "Romance",
        [878] = "Science Fiction",
        [10770] = "TV Movie",
        [53] = "Thriller",
        [10752] = "War",
        [37] = "Western",
        [10759] = "Action & Adventure",
        [10762] = "Kids",
        [10763] = "News",
        [10764] = "Reality",
        [10765] = "Sci-Fi & Fantasy",
        [10766] = "Soap",
        [10767] = "Talk",
        [10768] = "War & Politics",
    };

    private readonly ILibraryManager _library;

    public CatalogMapper(ILibraryManager library)
    {
        _library = library;
    }

    /// <summary>Seerr's MediaStatus as a <see cref="CatalogState"/>; unknown or missing is <see cref="CatalogState.None"/>.</summary>
    public static string MapStatus(int? status) => status switch
    {
        2 => CatalogState.Requested,
        3 => CatalogState.Downloading,
        4 => CatalogState.PartlyAvailable,
        5 => CatalogState.Available,
        6 => CatalogState.Blocklisted,
        _ => CatalogState.None,
    };

    /// <summary>The TMDB file name in a Seerr image path ("/abc.jpg" → "abc.jpg"), or null if the image proxy wouldn't accept it.</summary>
    public static string? ImageFile(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return null;
        }

        var file = path.StartsWith('/') ? path[1..] : path;
        return TmdbImageCache.IsAllowed("original", file) ? file : null;
    }

    /// <summary>Genre names for TMDB genre ids, in order; unknown ids are skipped.</summary>
    public static IReadOnlyList<string> GenreNames(IEnumerable<int>? ids) =>
        ids?.Select(id => GenreTable.GetValueOrDefault(id)).OfType<string>().Distinct(StringComparer.Ordinal).ToList() ?? [];

    /// <summary>The first YouTube trailer as a watch URL, or null. Keys are validated so only a plain video id is ever used.</summary>
    public static string? TrailerUrl(IEnumerable<SeerrVideo>? videos) =>
        videos?
            .Where(v => string.Equals(v.Site, "YouTube", StringComparison.Ordinal) && string.Equals(v.Type, "Trailer", StringComparison.Ordinal))
            .Select(v => v.Key)
            .Where(k => k is not null && YouTubeKey().IsMatch(k))
            .Select(k => "https://www.youtube.com/watch?v=" + k)
            .FirstOrDefault();

    /// <summary>
    /// A show's seasons (season 0, specials, excluded): Seerr's season availability if it has some, else Requested
    /// when a request that wasn't declined includes the season.
    /// </summary>
    public static IReadOnlyList<CatalogSeasonDto> Seasons(SeerrTitle title)
    {
        var info = title.MediaInfo;
        var requested = (info?.Requests ?? [])
            .Where(r => r.Status != 3)
            .SelectMany(r => r.Seasons ?? [])
            .Select(s => s.SeasonNumber)
            .ToHashSet();
        return (title.Seasons ?? [])
            .Where(s => s.SeasonNumber > 0)
            .GroupBy(s => s.SeasonNumber)
            .Select(g => g.First())
            .OrderBy(s => s.SeasonNumber)
            .Select(s =>
            {
                var status = info?.Seasons?.FirstOrDefault(x => x.SeasonNumber == s.SeasonNumber)?.Status;
                var state = MapStatus(status) switch
                {
                    CatalogState.Available => CatalogState.Available,
                    CatalogState.PartlyAvailable => CatalogState.PartlyAvailable,
                    CatalogState.Downloading => CatalogState.Downloading,
                    _ when requested.Contains(s.SeasonNumber) => CatalogState.Requested,
                    _ => CatalogState.None,
                };
                var name = string.IsNullOrWhiteSpace(s.Name) ? "Season " + s.SeasonNumber.ToString(CultureInfo.InvariantCulture) : s.Name;
                return new CatalogSeasonDto(s.SeasonNumber, name, Math.Max(0, s.EpisodeCount), state);
            })
            .ToList();
    }

    /// <summary>Catalog items for a result list: people and malformed entries dropped, at most <paramref name="take"/>.</summary>
    public IReadOnlyList<CatalogItemDto> ToItems(IEnumerable<SeerrMedia>? results, User? user, int take = int.MaxValue) =>
        (results ?? [])
            .Where(r => CatalogMediaType.IsValid(r.MediaType))
            .Select(r => ToItem(r.MediaType!, r, user))
            .OfType<CatalogItemDto>()
            .Take(take)
            .ToList();

    /// <summary>A catalog item, or null when <paramref name="media"/> has no valid TMDB id.</summary>
    public CatalogItemDto? ToItem(string mediaType, SeerrMedia media, User? user, IReadOnlyList<string>? genreNames = null)
    {
        if (media.Id <= 0 || !CatalogMediaType.IsValid(mediaType))
        {
            return null;
        }

        var tv = mediaType == CatalogMediaType.Tv;
        var title = (tv ? media.Name : media.Title) ?? media.Title ?? media.Name ?? string.Empty;
        var state = MapStatus(media.MediaInfo?.Status);
        return new CatalogItemDto(
            mediaType + "-" + media.Id.ToString(CultureInfo.InvariantCulture),
            mediaType,
            media.Id,
            title,
            Year(tv ? media.FirstAirDate : media.ReleaseDate),
            string.IsNullOrWhiteSpace(media.Overview) ? null : media.Overview,
            media.VoteAverage is > 0 and var v ? Math.Round(v, 1, MidpointRounding.AwayFromZero) : null,
            genreNames ?? GenreNames(media.GenreIds),
            ImageFile(media.PosterPath),
            ImageFile(media.BackdropPath),
            state,
            state is CatalogState.Available or CatalogState.PartlyAvailable ? VisibleItemId(media.MediaInfo?.JellyfinMediaId, user) : null);
    }

    /// <summary>The title page DTO. <paramref name="access"/> decides <see cref="CatalogTitleDto.CanRequest"/>.</summary>
    public CatalogTitleDto ToTitle(string mediaType, SeerrTitle title, IReadOnlyList<CatalogItemDto> recommendations, RequestAccess access, User? user)
    {
        var genres = title.Genres is { Count: > 0 }
            ? title.Genres.Select(g => g.Name).OfType<string>().Where(n => n.Length > 0).ToList()
            : GenreNames(title.GenreIds);
        var item = ToItem(mediaType, title, user, genres)
            ?? throw new SeerrException("Seerr returned a title without an id.");
        var tv = mediaType == CatalogMediaType.Tv;
        var seasons = tv ? Seasons(title) : [];

        // A movie can be requested once; a show while any season is still unrequested.
        var canRequest = (tv ? access.CanRequestTv : access.CanRequestMovies)
            && item.State is not (CatalogState.Available or CatalogState.Blocklisted)
            && (tv ? seasons.Any(s => s.State == CatalogState.None) : item.State == CatalogState.None);
        return new CatalogTitleDto(item)
        {
            Runtime = !tv && title.Runtime is > 0 ? title.Runtime : null,
            TrailerUrl = TrailerUrl(title.RelatedVideos),
            Cast = (title.Credits?.Cast ?? [])
                .Where(c => c.Id > 0 && !string.IsNullOrWhiteSpace(c.Name))
                .Take(MaxCast)
                .Select(c => new CatalogCastDto(c.Id, c.Name!, string.IsNullOrWhiteSpace(c.Character) ? null : c.Character, ImageFile(c.ProfilePath)))
                .ToList(),
            Seasons = seasons,
            Recommendations = recommendations.Take(MaxRecommendations).ToList(),
            CanRequest = canRequest,
        };
    }

    private static int? Year(string? date) =>
        date is { Length: >= 4 } && int.TryParse(date.AsSpan(0, 4), NumberStyles.None, CultureInfo.InvariantCulture, out var year) && year > 0 ? year : null;

    [GeneratedRegex("^[A-Za-z0-9_-]{6,20}$")]
    private static partial Regex YouTubeKey();

    private string? VisibleItemId(string? jellyfinMediaId, User? user) =>
        user is not null
        && Guid.TryParse(jellyfinMediaId, out var id)
        && id != Guid.Empty
        && _library.GetItemById<BaseItem>(id, user) is not null
            ? id.ToString("N", CultureInfo.InvariantCulture)
            : null;
}
