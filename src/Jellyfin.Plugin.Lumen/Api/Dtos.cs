using System.Diagnostics.CodeAnalysis;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Model.Dto;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Settings the client needs before rendering anything.</summary>
public sealed class ClientConfigDto
{
    public bool Enabled { get; init; }

    public bool HomeTakeover { get; init; }

    public bool DetailsTakeover { get; init; }

    public bool LibraryTakeover { get; init; }

    public bool StyleStockPages { get; init; }

    public bool StyleVideoPlayer { get; init; }

    public string AccentColor { get; init; } = string.Empty;

    public int HeroIntervalSeconds { get; init; }

    public bool TrailerPreview { get; init; }

    public int TrailerDelaySeconds { get; init; }

    public bool HeroWaitForTrailer { get; init; }

    /// <summary>
    /// Titles without a local trailer preview their trailer online, from IMDb or else YouTube (only with
    /// <see cref="TrailerPreview"/>). Named for the setting's first form, which was YouTube's alone.
    /// </summary>
    public bool YouTubeTrailers { get; init; }

    /// <summary>Where to load YouTube's player from instead of YouTube (<see cref="YouTubeEmbed"/>); null everywhere but in tests.</summary>
    public string? YouTubeEmbedBase { get; init; }

    /// <summary>
    /// Seerr is set up for request features. Whether this user may use them is GET /Lumen/Requests/Status's to say; this
    /// only spares servers without Seerr from asking (the request progress check, the account menu's My requests).
    /// </summary>
    public bool Requests { get; init; }

    /// <summary>
    /// A Trakt key is saved: the Top charts page exists, and the Top 10 rows link to it. The key itself never leaves the
    /// server.
    /// </summary>
    public bool Charts { get; init; }

    public string BuildHash { get; init; } = string.Empty;

    public static ClientConfigDto From(PluginConfiguration config, string buildHash) => new()
    {
        Enabled = config.Enabled,
        HomeTakeover = config.HomeTakeover,
        DetailsTakeover = config.DetailsTakeover,
        LibraryTakeover = config.LibraryTakeover,
        StyleStockPages = config.StyleStockPages,
        StyleVideoPlayer = config.StyleVideoPlayer,
        AccentColor = config.AccentColor,
        HeroIntervalSeconds = config.HeroIntervalSeconds,
        TrailerPreview = config.TrailerPreview,
        TrailerDelaySeconds = config.TrailerDelaySeconds,
        HeroWaitForTrailer = config.HeroWaitForTrailer,
        YouTubeTrailers = config.TrailerPreview && config.YouTubeTrailers,
        YouTubeEmbedBase = YouTubeEmbed.OverrideBase,
        Requests = config.Enabled && Jellyfin.Plugin.Lumen.Requests.SeerrEndpoint.From(config) is not null,
        Charts = config.Enabled && !string.IsNullOrWhiteSpace(config.TraktClientId),
        BuildHash = buildHash,
    };
}

/// <summary>A client's compatibility self-test result.</summary>
public sealed class CompatReportDto
{
    public string Client { get; set; } = string.Empty;

    public string ServerVersion { get; set; } = string.Empty;

    [SuppressMessage("Usage", "CA2227:Collection properties should be read only", Justification = "JSON model binding.")]
    [SuppressMessage("Design", "CA1002:Do not expose generic lists", Justification = "JSON model binding.")]
    public List<string> FailedChecks { get; set; } = [];
}

/// <summary>
/// One hero slide. Without a local trailer, at most one of: <c>TrailerImdbUrl</c>, an MP4 on IMDb's video CDN (checked by
/// <see cref="ImdbTrailers"/>, never another address), with <c>TrailerImdbUrlHd</c> its 1080p MP4 there when IMDb has
/// that besides; or <c>TrailerYouTubeId</c>, a checked YouTube video id (<see cref="YouTubeId"/>), never a URL.
/// </summary>
public sealed record HeroItemDto(BaseItemDto Item, Guid? TrailerItemId, string? TrailerYouTubeId = null, string? TrailerImdbUrl = null, string? TrailerImdbUrlHd = null);

/// <summary>
/// Response of GET /Lumen/Items/{itemId}/Trailer and GET /Lumen/Requests/Title/{mediaType}/{tmdbId}/Trailer: the title's
/// trailer online (<see cref="OnlineTrailer"/>), all null when there's none to play. A title page gets IMDb's MP4 (and
/// its 1080p one, when there is one) and YouTube's video id together: YouTube's plays should IMDb's file not play in the
/// browser.
/// </summary>
public sealed record OnlineTrailerDto(string? ImdbUrl, string? YouTubeId, string? ImdbUrlHd = null)
{
    public static OnlineTrailerDto From(OnlineTrailer trailer)
    {
        ArgumentNullException.ThrowIfNull(trailer);
        return new(trailer.ImdbUrl, trailer.YouTubeId, trailer.ImdbUrlHd);
    }
}

/// <summary>
/// One home row. Catalog rows (discover lists, My Requests) have an empty <c>Items</c> and set <c>Entries</c>, one ordered
/// list mixing library cards and catalog cards (requests design spec, §3); other rows leave <c>Entries</c> null.
/// </summary>
public sealed record HomeRowDto(string Id, string Type, string Title, IReadOnlyList<BaseItemDto> Items)
{
    public IReadOnlyList<HomeRowEntryDto>? Entries { get; init; }

    /// <summary>Gets <see cref="Home.HomeRow.Source"/>: "Seerr" for a Top 10 row showing Seerr's trending list instead of Trakt's.</summary>
    public string? Source { get; init; }
}

/// <summary>One card of a catalog row: exactly one of <c>Item</c> (a title in the library) or <c>Catalog</c> is set.</summary>
public sealed record HomeRowEntryDto(BaseItemDto? Item, CatalogItemDto? Catalog);

/// <summary>
/// Response of GET /Lumen/Home. <c>Badges</c> maps a hero or row item id (Guid "N" format, as in
/// <see cref="BaseItemDto.Id"/>) to a card badge key (see <see cref="CardBadges"/>); items without a badge are omitted.
/// </summary>
public sealed record HomeResponseDto(
    int ConfigVersion,
    IReadOnlyList<HeroItemDto> Hero,
    IReadOnlyList<HomeRowDto> Rows,
    IReadOnlyDictionary<string, string> Badges);

/// <summary>400 body for an invalid configuration.</summary>
public sealed record ValidationErrorsDto(IReadOnlyList<string> Errors);

/// <summary>A section parameter for the admin form.</summary>
public sealed record SectionParameterDto(string Name, string Label, string Kind, bool Required, string? DefaultValue, int? Min, int? Max)
{
    public static SectionParameterDto From(SectionParameter p) => new(p.Name, p.Label, p.Kind.ToString(), p.Required, p.DefaultValue, p.Min, p.Max);
}

/// <summary>A section type for the admin form.</summary>
public sealed record SectionTypeDto(string Type, string DisplayName, string Description, IReadOnlyList<SectionParameterDto> Parameters)
{
    public static SectionTypeDto From(IHomeSectionProvider provider) =>
        new(provider.Type, provider.DisplayName, provider.Description, provider.Parameters.Select(SectionParameterDto.From).ToList());
}

/// <summary>
/// Response of GET /Lumen/Requests/Status. <c>ImageToken</c> goes in catalog image URLs (<see cref="Requests.CatalogImageToken"/>);
/// null without catalog access.
/// </summary>
public sealed record RequestStatusDto(bool Enabled, bool CanRequestMovies, bool CanRequestTv, string? ImageToken = null);

/// <summary>Body of POST /Lumen/Admin/Seerr/Test. A null or empty key means "use the stored key".</summary>
public sealed record SeerrTestRequestDto(string? Url, string? ApiKey);

/// <summary>
/// Result of a Seerr connection test. <c>SameJellyfinServer</c> is false when Seerr is linked to a different Jellyfin
/// server (accounts can then never match), null when Seerr isn't set up for Jellyfin or that couldn't be read.
/// </summary>
public sealed record SeerrTestResultDto(bool Ok, string? Version, string? Error, string? JellyfinServerName = null, bool? SameJellyfinServer = null);

/// <summary>Response of GET /Lumen/Admin/Seerr/Users.</summary>
public sealed record SeerrUsersDto(string? JellyfinServerName, bool? SameJellyfinServer, IReadOnlyList<UnmappedUserDto> Unmapped);

/// <summary>A Jellyfin user without a Seerr account (they get no catalog until imported in Seerr).</summary>
public sealed record UnmappedUserDto(Guid Id, string Name);
