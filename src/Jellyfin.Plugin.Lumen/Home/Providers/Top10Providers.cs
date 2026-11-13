using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using Jellyfin.Plugin.Lumen.Trakt;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// A "Top 10 this week" row (Top 10 design note, 2026-11-12): Trakt's most watched titles of the week (the Top charts
/// page's "This week", one cached copy for both), or, without a Trakt key (or before Trakt first answers), Seerr's
/// trending list. Cards as in every Trakt row (<see cref="TraktCards"/>); the client numbers them 1..n in the order given.
/// </summary>
public abstract class Top10Provider : TraktRowProvider
{
    public const int Size = 10;

    private readonly TraktListKind _kind;
    private readonly string _mediaType;
    private readonly ISeerrClient _seerr;
    private readonly CatalogMapper _mapper;
    private readonly ILogger _logger;

    protected Top10Provider(
        TraktListKind kind,
        ITraktLists lists,
        CatalogRowAccess access,
        TraktCards cards,
        ISeerrClient seerr,
        CatalogMapper mapper,
        TimeProvider time,
        ILogger logger)
        : base(lists, access, cards, time)
    {
        _kind = kind;
        _mediaType = kind == TraktListKind.Movies ? CatalogMediaType.Movie : CatalogMediaType.Tv;
        _seerr = seerr;
        _mapper = mapper;
        _logger = logger;
    }

    protected override int MaxCards => Size;

    protected override TraktQuery Query(SectionDefinition definition) => TraktQuery.Watched(_kind, TraktPeriod.Weekly);

    /// <summary>Seerr's trending titles of this row's type (TMDB's trending list, which mixes movies and shows).</summary>
    protected override async Task<IReadOnlyList<HomeRowEntry>> FallbackAsync(
        (SeerrEndpoint Endpoint, int SeerrUserId)? caller,
        User user,
        int limit,
        CancellationToken cancellationToken)
    {
        if (caller is not { } seerr)
        {
            return [];
        }

        try
        {
            var items = new List<CatalogItemDto>();
            for (var page = 1; page <= 2 && items.Count < limit; page++)
            {
                var results = await _seerr.DiscoverPageAsync(seerr.Endpoint, seerr.SeerrUserId, SeerrDiscoverList.Trending, page, cancellationToken).ConfigureAwait(false);
                items.AddRange((results.Results ?? [])
                    .Where(m => m.MediaType == _mediaType)
                    .Select(m => _mapper.ToItem(_mediaType, m, user))
                    .OfType<CatalogItemDto>()
                    .Where(i => items.TrueForAll(x => x.Key != i.Key)));
                if (results.TotalPages <= page)
                {
                    break;
                }
            }

            // As in the catalog rows: a title the user can watch becomes its library item (once), the rest catalog cards.
            var seen = new HashSet<Guid>();
            return items
                .Select(i => _mapper.VisibleItem(i.JellyfinItemId, user) is { } owned ? HomeRowEntry.ForItem(owned) : HomeRowEntry.ForCatalog(i))
                .Where(e => e.Item is null || seen.Add(e.Item.Id))
                .Take(limit)
                .ToList();
        }
        catch (SeerrException e)
        {
            // Fail open, like the catalog rows: the row just disappears. The breaker already logs outages once.
            if (!e.IsCircuitOpen && _logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug("Lumen dropped the {Type} row: {Message}", Type, e.LogText);
            }

            return [];
        }
    }
}

/// <summary>Trakt's most watched movies this week.</summary>
public sealed class Top10MoviesProvider : Top10Provider
{
    public Top10MoviesProvider(
        ITraktLists lists,
        CatalogRowAccess access,
        TraktCards cards,
        ISeerrClient seerr,
        CatalogMapper mapper,
        TimeProvider time,
        ILogger<Top10MoviesProvider> logger)
        : base(TraktListKind.Movies, lists, access, cards, seerr, mapper, time, logger)
    {
    }

    public override string Type => SectionTypes.Top10Movies;

    public override string DisplayName => "Top 10 Movies";

    public override string Description =>
        "The week's most watched movies on Trakt, ranked (Seerr's trending movies without a Trakt key); titles not on the server can be requested.";

    protected override string RowTitle(TraktList? list) => "Top 10 Movies This Week";
}

/// <summary>Trakt's most watched shows this week.</summary>
public sealed class Top10ShowsProvider : Top10Provider
{
    public Top10ShowsProvider(
        ITraktLists lists,
        CatalogRowAccess access,
        TraktCards cards,
        ISeerrClient seerr,
        CatalogMapper mapper,
        TimeProvider time,
        ILogger<Top10ShowsProvider> logger)
        : base(TraktListKind.Shows, lists, access, cards, seerr, mapper, time, logger)
    {
    }

    public override string Type => SectionTypes.Top10Shows;

    public override string DisplayName => "Top 10 Shows";

    public override string Description =>
        "The week's most watched shows on Trakt, ranked (Seerr's trending shows without a Trakt key); titles not on the server can be requested.";

    protected override string RowTitle(TraktList? list) => "Top 10 Shows This Week";
}
