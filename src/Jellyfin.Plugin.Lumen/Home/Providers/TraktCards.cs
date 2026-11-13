using System.Globalization;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Requests;
using Jellyfin.Plugin.Lumen.Trakt;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// Turns Trakt titles into cards, for the Trakt rows (Top 10 and the rest) and the Top charts page (Top 10 and Trakt
/// design notes, 2026-11-12). Titles the user can watch are their library items, matched by TMDB id, then IMDb id, among
/// the items the user can access, so restricted users never see an item they can't open. With Seerr, the other titles
/// are catalog cards the user can request, from Seerr's (cached) title summaries; without it they're skipped, since they
/// can be neither requested nor pictured.
/// </summary>
public sealed class TraktCards
{
    /// <summary>Seerr lookups at once for titles the server doesn't have.</summary>
    public const int MaxConcurrentDetails = 6;

    private readonly ISeerrClient _seerr;
    private readonly CatalogMapper _mapper;
    private readonly ILibraryManager _library;
    private readonly TimeProvider _time;
    private readonly ILogger<TraktCards> _logger;

    public TraktCards(ISeerrClient seerr, CatalogMapper mapper, ILibraryManager library, TimeProvider time, ILogger<TraktCards> logger)
    {
        _seerr = seerr;
        _mapper = mapper;
        _library = library;
        _time = time;
        _logger = logger;
    }

    /// <summary>Whether title <paramref name="index"/> can have a card: it's here, or Seerr can picture it (by TMDB id).</summary>
    public static bool CanShow(IReadOnlyList<TraktTitle> titles, int index, Dictionary<int, BaseItem> owned, bool withSeerr) =>
        owned.ContainsKey(index) || (withSeerr && titles[index].TmdbId is not null);

    /// <summary>
    /// The library items among <paramref name="titles"/> that <paramref name="user"/> can access, by position in the list.
    /// One query for the whole list; the user's query applies their library access and parental controls. TMDB ids are
    /// per type (movie 603 isn't show 603), so they're matched with the title's type; IMDb ids are unique.
    /// </summary>
    public Dictionary<int, BaseItem> MatchOwned(IReadOnlyList<TraktTitle> titles, User user)
    {
        var tmdbIds = titles.Select(t => t.TmdbId).OfType<int>().Distinct().Select(id => id.ToString(CultureInfo.InvariantCulture)).ToArray();
        var imdbIds = titles.Select(t => t.ImdbId).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var ids = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (tmdbIds.Length > 0)
        {
            ids[nameof(MetadataProvider.Tmdb)] = tmdbIds;
        }

        if (imdbIds.Length > 0)
        {
            ids[nameof(MetadataProvider.Imdb)] = imdbIds;
        }

        if (ids.Count == 0)
        {
            return [];
        }

        var kinds = titles.Select(t => t.Kind).Distinct().Select(k => k == TraktListKind.Movies ? BaseItemKind.Movie : BaseItemKind.Series).Order().ToArray();
        var items = _library.GetItemList(new InternalItemsQuery(user)
        {
            IncludeItemTypes = kinds,
            Recursive = true,
            HasAnyProviderIds = ids,
            DtoOptions = QueryOptions.Full(),
        });

        // A title in two libraries (or two versions) is matched to the first the query returns.
        var byTmdb = new Dictionary<(TraktListKind, string), BaseItem>();
        var byImdb = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in items)
        {
            var kind = item is Series ? TraktListKind.Shows : TraktListKind.Movies;
            if (item.GetProviderId(MetadataProvider.Tmdb) is { Length: > 0 } tmdb)
            {
                byTmdb.TryAdd((kind, tmdb), item);
            }

            if (item.GetProviderId(MetadataProvider.Imdb) is { Length: > 0 } imdb)
            {
                byImdb.TryAdd(imdb, item);
            }
        }

        var owned = new Dictionary<int, BaseItem>();
        for (var i = 0; i < titles.Count; i++)
        {
            var title = titles[i];
            if ((title.TmdbId is { } tmdb && byTmdb.TryGetValue((title.Kind, tmdb.ToString(CultureInfo.InvariantCulture)), out var item))
                || (title.ImdbId is { } imdb && byImdb.TryGetValue(imdb, out item)))
            {
                owned[i] = item;
            }
        }

        return owned;
    }

    /// <summary>
    /// A home row's cards: Trakt's first titles that can have one, up to <paramref name="limit"/>, in Trakt's order. Seerr
    /// lookups run a few at a time until <paramref name="budget"/> from <paramref name="started"/>, then the row is returned
    /// with the titles resolved so far, so a cold Seerr cache costs a few titles rather than the whole row (the rest
    /// finish and warm the cache for next time). Lookups that failed leave gaps that owned titles from further down the
    /// list fill, still in Trakt's order, rather than a short or hidden row. A title listed twice (or two titles that are
    /// one item) shows once.
    /// </summary>
    public async Task<IReadOnlyList<HomeRowEntry>> RowAsync(
        IReadOnlyList<TraktTitle> titles,
        (SeerrEndpoint Endpoint, int SeerrUserId)? caller,
        User user,
        int limit,
        long started,
        TimeSpan budget,
        CancellationToken cancellationToken)
    {
        var owned = MatchOwned(titles, user);

        // The first titles that can have a card, a few spare in case a Seerr lookup fails or two titles are one item.
        var candidates = Enumerable.Range(0, titles.Count)
            .Where(i => CanShow(titles, i, owned, caller is not null))
            .Take(limit + 4)
            .ToList();
        var lookups = await ResolveAsync(titles, candidates, owned, caller, user, started, budget, cancellationToken).ConfigureAwait(false);

        var seen = new HashSet<Guid>();
        var catalogKeys = new HashSet<string>(StringComparer.Ordinal);
        var entries = lookups
            .OfType<HomeRowEntry>()
            .Where(e => e.Item is null ? catalogKeys.Add(e.Catalog!.Key) : seen.Add(e.Item.Id))
            .Take(limit)
            .ToList();

        var lastCandidate = candidates.Count > 0 ? candidates[^1] : -1;
        foreach (var (_, item) in owned.Where(o => o.Key > lastCandidate).OrderBy(o => o.Key))
        {
            if (entries.Count >= limit)
            {
                break;
            }

            if (seen.Add(item.Id))
            {
                entries.Add(HomeRowEntry.ForItem(item));
            }
        }

        return entries;
    }

    /// <summary>
    /// The cards for the titles at <paramref name="indexes"/>, in that order: null where Seerr couldn't describe a title
    /// (or hadn't by the end of the <paramref name="budget"/>, counted from <paramref name="started"/>).
    /// <paramref name="missed"/> is called once for each title left out that asking again may bring: Seerr failed or was
    /// too slow. Not for one Seerr doesn't know (404) or the user may not see, which no retry changes.
    /// </summary>
    public async Task<IReadOnlyList<HomeRowEntry?>> ResolveAsync(
        IReadOnlyList<TraktTitle> titles,
        IReadOnlyList<int> indexes,
        Dictionary<int, BaseItem> owned,
        (SeerrEndpoint Endpoint, int SeerrUserId)? caller,
        User user,
        long started,
        TimeSpan budget,
        CancellationToken cancellationToken,
        Action? missed = null)
    {
        // Not disposed: lookups still running after the budget keep using it (it holds no OS handle).
        var gate = new SemaphoreSlim(MaxConcurrentDetails);
        var lookups = indexes
            .Select(i => owned.TryGetValue(i, out var item)
                ? Task.FromResult<HomeRowEntry?>(HomeRowEntry.ForItem(item))
                : caller is { } seerr && titles[i].TmdbId is { } tmdbId
                    ? LookUpAsync(seerr.Endpoint, seerr.SeerrUserId, titles[i].Kind, tmdbId, user, gate, missed, cancellationToken)
                    : Task.FromResult<HomeRowEntry?>(null))
            .ToList();
        var all = Task.WhenAll(lookups);
        var left = budget - _time.GetElapsedTime(started);
        if (left > TimeSpan.Zero)
        {
            await Task.WhenAny(all, Task.Delay(left, _time, cancellationToken)).ConfigureAwait(false);
        }

        _ = all.ContinueWith(t => _ = t.Exception, CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);

        // Each lookup's status read once, for its card and the count both: one finishing between two reads would be
        // left out of the cards and not counted as missing.
        var cards = new List<HomeRowEntry?>(lookups.Count);
        var late = 0;
        foreach (var lookup in lookups)
        {
            var status = lookup.Status;
            cards.Add(status == TaskStatus.RanToCompletion ? lookup.Result : null);

            // The lookups still running count too; one of them failing later is counted again, after the caller has read.
            if (status is not (TaskStatus.RanToCompletion or TaskStatus.Faulted or TaskStatus.Canceled))
            {
                late++;
            }
        }

        for (; late > 0 && missed is not null; late--)
        {
            missed();
        }

        return cards;
    }

    /// <summary>The card for a title the user can't watch here (yet), or null if Seerr couldn't give its details.</summary>
    private async Task<HomeRowEntry?> LookUpAsync(SeerrEndpoint endpoint, int seerrUserId, TraktListKind kind, int tmdbId, User user, SemaphoreSlim gate, Action? missed, CancellationToken cancellationToken)
    {
        var mediaType = kind == TraktListKind.Movies ? CatalogMediaType.Movie : CatalogMediaType.Tv;
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        SeerrTitle title;
        try
        {
            title = await _seerr.GetTitleSummaryAsync(endpoint, seerrUserId, mediaType, tmdbId, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException e)
        {
            if (!e.IsCircuitOpen && _logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug("Lumen skipped Trakt's TMDB {MediaType} {TmdbId}: {Message}", mediaType, tmdbId, e.Message);
            }

            if (e.Status != System.Net.HttpStatusCode.NotFound)
            {
                missed?.Invoke();
            }

            return null;
        }
        finally
        {
            gate.Release();
        }

        if (_mapper.ToItem(mediaType, title, user, CatalogMapper.TitleGenreNames(title)) is not { } item)
        {
            return null;
        }

        // Seerr knows it's on the server where the library match didn't (an item without a TMDB or IMDb id, say).
        return _mapper.VisibleItem(item.JellyfinItemId, user) is { } visible ? HomeRowEntry.ForItem(visible) : HomeRowEntry.ForCatalog(item);
    }
}
