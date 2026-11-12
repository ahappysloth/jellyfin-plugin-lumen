using System.Globalization;

namespace Jellyfin.Plugin.Lumen.Trakt;

/// <summary>Movies or shows.</summary>
public enum TraktListKind
{
    Movies,
    Shows,
}

/// <summary>The span a most-watched chart covers: Trakt's <c>/watched/{period}</c>.</summary>
public enum TraktPeriod
{
    Weekly,
    Monthly,
    Yearly,
    All,
}

/// <summary>What a Trakt list's entries hold.</summary>
public enum TraktContent
{
    Movies,
    Shows,

    /// <summary>Both, each entry saying which (a user's list).</summary>
    Mixed,
}

/// <summary>
/// One Trakt list Lumen reads, and how long a copy of it stays fresh (Trakt design note, 2026-11-12). Two equal queries
/// are the same list: <see cref="TraktLists"/> caches by query, so the Top 10 rows and the Top charts page's "This week"
/// share one copy of the weekly chart. Every query only needs the app's Client ID (no user sign-in).
/// </summary>
/// <param name="Path">The API path, relative to Trakt's address, without a query string.</param>
/// <param name="Content">What the entries hold.</param>
/// <param name="Limit">How many titles to read at most (Trakt's pages are followed until there are this many).</param>
/// <param name="FreshFor">How long a copy is served before it's refreshed.</param>
/// <param name="Name">What the list is, for the server log ("Trakt's box office").</param>
/// <param name="List">For a user's list, which one: its name is read too, for the row's default title.</param>
public sealed record TraktQuery(string Path, TraktContent Content, int Limit, TimeSpan FreshFor, string Name, TraktListRef? List = null)
{
    /// <summary>How many titles a chart ranks (the Top charts page).</summary>
    public const int ChartSize = 100;

    /// <summary>Read for the Trending and Most Anticipated rows: more than a row shows, as some titles are skipped.</summary>
    public const int RowFetchLimit = 40;

    /// <summary>How many titles of a user's list Lumen reads.</summary>
    public const int ListLimit = 100;

    /// <summary>Like the Top 10 rows: these lists move slowly, and the weekly one is shared with them.</summary>
    public static readonly TimeSpan ChartFreshFor = TimeSpan.FromHours(3);

    /// <summary>Box office figures come out once a weekend.</summary>
    public static readonly TimeSpan BoxOfficeFreshFor = TimeSpan.FromHours(12);

    public static readonly TimeSpan AnticipatedFreshFor = TimeSpan.FromHours(6);

    /// <summary>What's being watched right now changes by the hour.</summary>
    public static readonly TimeSpan TrendingFreshFor = TimeSpan.FromMinutes(30);

    public static readonly TimeSpan ListFreshFor = TimeSpan.FromHours(1);

    /// <summary>This weekend's US box office: Trakt's top 10 movies.</summary>
    public static TraktQuery BoxOffice { get; } = new("movies/boxoffice", TraktContent.Movies, 10, BoxOfficeFreshFor, "box office");

    /// <summary>The most watched titles of a period, most watched first: the Top 10 rows (weekly) and Top charts.</summary>
    public static TraktQuery Watched(TraktListKind kind, TraktPeriod period) => new(
        string.Create(CultureInfo.InvariantCulture, $"{Resource(kind)}/watched/{PeriodName(period)}"),
        ContentOf(kind),
        ChartSize,
        ChartFreshFor,
        string.Create(CultureInfo.InvariantCulture, $"{PeriodName(period)} most watched {Resource(kind)}"));

    /// <summary>The upcoming titles most added to lists.</summary>
    public static TraktQuery Anticipated(TraktListKind kind) =>
        new($"{Resource(kind)}/anticipated", ContentOf(kind), RowFetchLimit, AnticipatedFreshFor, $"most anticipated {Resource(kind)}");

    /// <summary>The titles most watched right now.</summary>
    public static TraktQuery Trending(TraktListKind kind) =>
        new($"{Resource(kind)}/trending", ContentOf(kind), RowFetchLimit, TrendingFreshFor, $"trending {Resource(kind)}");

    /// <summary>A public list's movies and shows, in the list's order.</summary>
    public static TraktQuery ListItems(TraktListRef list) =>
        new(list.ApiPath + "/items/movie,show", TraktContent.Mixed, ListLimit, ListFreshFor, "list " + list, list);

    /// <summary>Trakt's name for a period in its paths.</summary>
    public static string PeriodName(TraktPeriod period) => period switch
    {
        TraktPeriod.Weekly => "weekly",
        TraktPeriod.Monthly => "monthly",
        TraktPeriod.Yearly => "yearly",
        _ => "all",
    };

    private static string Resource(TraktListKind kind) => kind == TraktListKind.Movies ? "movies" : "shows";

    private static TraktContent ContentOf(TraktListKind kind) => kind == TraktListKind.Movies ? TraktContent.Movies : TraktContent.Shows;
}
