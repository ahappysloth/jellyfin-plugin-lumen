namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>
/// How a trailer lookup went, for the Trailer section of a title's Media info (GET …/TrailerInfo): stable strings the
/// client turns into words, never shown as they are.
/// </summary>
public static class TrailerStatus
{
    /// <summary>A trailer was found.</summary>
    public const string Found = "found";

    /// <summary>Asked, and there's none: IMDb has no trailer for the title, or Seerr (TMDB) no YouTube video.</summary>
    public const string NotFound = "notFound";

    /// <summary>The title's metadata has no id to ask by (an IMDb id for IMDb, a TMDB id for Seerr).</summary>
    public const string NoId = "noId";

    /// <summary>IMDb answered with an HTTP error (the detail says which).</summary>
    public const string HttpError = "httpError";

    /// <summary>IMDb didn't answer within <see cref="ImdbTrailers.Timeout"/>.</summary>
    public const string Timeout = "timeout";

    /// <summary>Anything else that went wrong asking (unreachable, an answer Lumen can't read, Seerr failing).</summary>
    public const string Error = "error";

    /// <summary>Not asked: a setting is off (<see cref="TrailerSkip"/> says which).</summary>
    public const string Skipped = "skipped";

    /// <summary>YouTube only: Seerr isn't set up, or this user has no Seerr access, so only the metadata was read.</summary>
    public const string NoSeerr = "noSeerr";
}

/// <summary>Why no online trailer is looked up for a title at all (<see cref="TrailerStatus.Skipped"/>).</summary>
public static class TrailerSkip
{
    public const string PreviewsOff = "previewsOff";
    public const string OnlineOff = "onlineOff";
}

/// <summary>Where a YouTube trailer's id came from.</summary>
public static class TrailerSource
{
    /// <summary>The item's own trailer links (<c>RemoteTrailers</c>), which Jellyfin's metadata fills from TMDB.</summary>
    public const string Jellyfin = "jellyfin";

    /// <summary>The title's videos as Seerr has them from TMDB.</summary>
    public const string Seerr = "seerr";
}

/// <summary>
/// How a lookup went: <paramref name="Status"/> (<see cref="TrailerStatus"/>), a short <paramref name="Detail"/> in plain
/// words (an HTTP status, never an address or an exception's text), and when it was asked.
/// </summary>
public sealed record TrailerOutcome(string Status, string? Detail, DateTimeOffset? FetchedAt);

/// <summary>
/// What the IMDb lookup for a title found: the id it asked by, how it went, which qualities IMDb has ("1080p", "720p"…;
/// the addresses are never part of it), and whether this answer was the server's cached one.
/// </summary>
public sealed record ImdbDiagnosis(string? ImdbId, TrailerOutcome Outcome, IReadOnlyList<string> Qualities, bool Cached);

/// <summary>
/// What the YouTube lookup for a title found: the video id and where it came from (<see cref="TrailerSource"/>), how it
/// went, and whether this answer was the server's cached one.
/// </summary>
public sealed record YouTubeDiagnosis(string? VideoId, string? Source, TrailerOutcome Outcome, bool Cached);
