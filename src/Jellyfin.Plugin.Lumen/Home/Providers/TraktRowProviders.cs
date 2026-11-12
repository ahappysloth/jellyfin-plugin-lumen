using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Trakt;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>This weekend's US box office: Trakt's top 10 movies, in order (without the Top 10 rows' numerals).</summary>
public sealed class TraktBoxOfficeProvider : TraktRowProvider
{
    public TraktBoxOfficeProvider(ITraktLists lists, CatalogRowAccess access, TraktCards cards, TimeProvider time)
        : base(lists, access, cards, time)
    {
    }

    public override string Type => SectionTypes.TraktBoxOffice;

    public override string DisplayName => "Box Office";

    public override string Description =>
        "This weekend's top 10 movies at the US box office, from Trakt (needs a Trakt key); titles not on the server can be requested.";

    protected override int MaxCards => TraktQuery.BoxOffice.Limit;

    protected override TraktQuery Query(SectionDefinition definition) => TraktQuery.BoxOffice;

    protected override string RowTitle(TraktList? list) => "Box Office This Weekend";
}

/// <summary>
/// Upcoming titles most added to Trakt lists. Hidden without Seerr: they're mostly not out yet, so hardly any are on the
/// server, and a row of the one or two that are would say little about what's anticipated (Trakt design note).
/// </summary>
public abstract class TraktAnticipatedProvider : TraktRowProvider
{
    private readonly TraktListKind _kind;

    protected TraktAnticipatedProvider(TraktListKind kind, ITraktLists lists, CatalogRowAccess access, TraktCards cards, TimeProvider time)
        : base(lists, access, cards, time)
    {
        _kind = kind;
    }

    protected override bool NeedsSeerr => true;

    protected override TraktQuery Query(SectionDefinition definition) => TraktQuery.Anticipated(_kind);
}

/// <summary>Upcoming movies most added to Trakt lists.</summary>
public sealed class TraktAnticipatedMoviesProvider : TraktAnticipatedProvider
{
    public TraktAnticipatedMoviesProvider(ITraktLists lists, CatalogRowAccess access, TraktCards cards, TimeProvider time)
        : base(TraktListKind.Movies, lists, access, cards, time)
    {
    }

    public override string Type => SectionTypes.TraktAnticipatedMovies;

    public override string DisplayName => "Most Anticipated Movies";

    public override string Description =>
        "Upcoming movies most added to lists on Trakt, to request ahead (needs a Trakt key and Seerr).";

    protected override string RowTitle(TraktList? list) => "Most Anticipated Movies";
}

/// <summary>Upcoming shows most added to Trakt lists.</summary>
public sealed class TraktAnticipatedShowsProvider : TraktAnticipatedProvider
{
    public TraktAnticipatedShowsProvider(ITraktLists lists, CatalogRowAccess access, TraktCards cards, TimeProvider time)
        : base(TraktListKind.Shows, lists, access, cards, time)
    {
    }

    public override string Type => SectionTypes.TraktAnticipatedShows;

    public override string DisplayName => "Most Anticipated Shows";

    public override string Description =>
        "Upcoming shows most added to lists on Trakt, to request ahead (needs a Trakt key and Seerr).";

    protected override string RowTitle(TraktList? list) => "Most Anticipated Shows";
}

/// <summary>What Trakt's users are watching right now.</summary>
public abstract class TraktTrendingProvider : TraktRowProvider
{
    private readonly TraktListKind _kind;

    protected TraktTrendingProvider(TraktListKind kind, ITraktLists lists, CatalogRowAccess access, TraktCards cards, TimeProvider time)
        : base(lists, access, cards, time)
    {
        _kind = kind;
    }

    protected override TraktQuery Query(SectionDefinition definition) => TraktQuery.Trending(_kind);
}

/// <summary>The movies Trakt's users are watching right now.</summary>
public sealed class TraktTrendingMoviesProvider : TraktTrendingProvider
{
    public TraktTrendingMoviesProvider(ITraktLists lists, CatalogRowAccess access, TraktCards cards, TimeProvider time)
        : base(TraktListKind.Movies, lists, access, cards, time)
    {
    }

    public override string Type => SectionTypes.TraktTrendingMovies;

    public override string DisplayName => "Trending Movies";

    public override string Description =>
        "The movies people are watching right now on Trakt (needs a Trakt key); titles not on the server can be requested.";

    protected override string RowTitle(TraktList? list) => "Trending Movies";
}

/// <summary>The shows Trakt's users are watching right now.</summary>
public sealed class TraktTrendingShowsProvider : TraktTrendingProvider
{
    public TraktTrendingShowsProvider(ITraktLists lists, CatalogRowAccess access, TraktCards cards, TimeProvider time)
        : base(TraktListKind.Shows, lists, access, cards, time)
    {
    }

    public override string Type => SectionTypes.TraktTrendingShows;

    public override string DisplayName => "Trending Shows";

    public override string Description =>
        "The shows people are watching right now on Trakt (needs a Trakt key); titles not on the server can be requested.";

    protected override string RowTitle(TraktList? list) => "Trending Shows";
}

/// <summary>
/// A public Trakt list's movies and shows, in the list's order, titled with the list's name unless the admin gives another.
/// A Text parameter, so it can be added more than once (one per list). A list that's private or gone is hidden (and
/// logged once, by <see cref="TraktLists"/>).
/// </summary>
public sealed class TraktListProvider : TraktRowProvider
{
    public const string UrlParam = "url";

    public TraktListProvider(ITraktLists lists, CatalogRowAccess access, TraktCards cards, TimeProvider time)
        : base(lists, access, cards, time)
    {
    }

    public override string Type => SectionTypes.TraktList;

    public override string DisplayName => "Trakt list";

    public override string Description =>
        "A public Trakt list, titled with the list's name unless you give it another (needs a Trakt key); titles not on the server can be requested.";

    public override IReadOnlyList<SectionParameter> Parameters { get; } =
        [new SectionParameter(UrlParam, "List address (https://trakt.tv/users/…/lists/…)", SectionParameterKind.Text, Required: true)];

    public override IReadOnlyList<string> Validate(SectionDefinition definition) =>
        definition.GetParam(UrlParam) is { } url && !TraktListRef.TryParse(url, out _)
            ? [TraktListRef.Invalid]
            : [];

    protected override TraktQuery? Query(SectionDefinition definition) =>
        TraktListRef.TryParse(definition.GetParam(UrlParam), out var list) ? TraktQuery.ListItems(list) : null;

    protected override string RowTitle(TraktList? list) => list?.Name ?? "Trakt list";
}
