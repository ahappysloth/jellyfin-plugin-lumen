using System.Globalization;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using Jellyfin.Plugin.Lumen.Top10;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// A "Top 10 this week" row (Top 10 design note, 2026-11-12): Trakt's most watched titles of the week, or, without a Trakt
/// key (or before Trakt first answers), Seerr's trending list. Titles the user can watch are their library items, matched
/// by TMDB id, then IMDb id, among the items the user can access, so restricted users never see an item they can't open.
/// With Seerr, the other titles are catalog cards the user can request; without it they are skipped, since they can be
/// neither requested nor pictured. The client numbers the cards 1..n in the order given.
/// </summary>
public abstract class Top10Provider : IHomeSectionProvider
{
    public const int Size = 10;

    /// <summary>Seerr lookups at once for titles the server doesn't have.</summary>
    public const int MaxConcurrentDetails = 6;

    /// <summary>
    /// How long, from the start, the row may take before it's returned with the titles resolved so far, so that a cold
    /// Seerr cache costs a few titles rather than the whole row (the rest finish and warm the cache for next time).
    /// </summary>
    private static readonly TimeSpan DetailsBudget = TimeSpan.FromSeconds(4.5);

    private readonly TraktListKind _kind;
    private readonly string _mediaType;
    private readonly ITop10Lists _lists;
    private readonly CatalogRowAccess _access;
    private readonly ISeerrClient _seerr;
    private readonly CatalogMapper _mapper;
    private readonly ILibraryManager _library;
    private readonly TimeProvider _time;
    private readonly ILogger _logger;

    protected Top10Provider(
        TraktListKind kind,
        ITop10Lists lists,
        CatalogRowAccess access,
        ISeerrClient seerr,
        CatalogMapper mapper,
        ILibraryManager library,
        TimeProvider time,
        ILogger logger)
    {
        _kind = kind;
        _mediaType = kind == TraktListKind.Movies ? CatalogMediaType.Movie : CatalogMediaType.Tv;
        _lists = lists;
        _access = access;
        _seerr = seerr;
        _mapper = mapper;
        _library = library;
        _time = time;
        _logger = logger;
    }

    public abstract string Type { get; }

    public abstract string DisplayName { get; }

    public abstract string Description { get; }

    public IReadOnlyList<SectionParameter> Parameters => [];

    /// <summary>The catalog rows' timeout: Trakt's own is shorter, and its list is cached, so this is rarely reached.</summary>
    public TimeSpan? Timeout => CatalogSectionProvider.RowTimeout;

    /// <summary>Gets the row's title on the home screen, unless the admin gave it another.</summary>
    protected abstract string RowTitle { get; }

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public async Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var started = _time.GetTimestamp();
        var limit = Math.Min(Size, context.ItemLimit);

        // Both at once: neither waits on the other, and both are usually cached.
        var accessTask = _access.GetAsync(context.User.Id, cancellationToken);
        var traktTask = _lists.GetAsync(_kind, cancellationToken);
        var caller = await accessTask.ConfigureAwait(false);
        var trakt = await traktTask.ConfigureAwait(false);

        IReadOnlyList<HomeRowEntry> entries;
        if (trakt is { Count: > 0 })
        {
            entries = await FromTraktAsync(trakt, caller, context.User, limit, started, cancellationToken).ConfigureAwait(false);
        }
        else if (caller is { } seerr)
        {
            entries = await FromTrendingAsync(seerr.Endpoint, seerr.SeerrUserId, context.User, limit, cancellationToken).ConfigureAwait(false);
        }
        else
        {
            return [];
        }

        return HomeRow.Catalog(definition, RowTitle, entries);
    }

    /// <summary>
    /// The library items among <paramref name="titles"/> that <paramref name="user"/> can access, by position in the list.
    /// One query for the whole list; the user's query applies their library access and parental controls.
    /// </summary>
    internal Dictionary<int, BaseItem> MatchOwned(IReadOnlyList<TraktTitle> titles, User user)
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

        var items = _library.GetItemList(new InternalItemsQuery(user)
        {
            IncludeItemTypes = [_kind == TraktListKind.Movies ? BaseItemKind.Movie : BaseItemKind.Series],
            Recursive = true,
            HasAnyProviderIds = ids,
            DtoOptions = QueryOptions.Full(),
        });

        // A title in two libraries (or two versions) is matched to the first the query returns.
        var byTmdb = new Dictionary<string, BaseItem>(StringComparer.Ordinal);
        var byImdb = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in items)
        {
            if (item.GetProviderId(MetadataProvider.Tmdb) is { Length: > 0 } tmdb)
            {
                byTmdb.TryAdd(tmdb, item);
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
            if ((title.TmdbId is { } tmdb && byTmdb.TryGetValue(tmdb.ToString(CultureInfo.InvariantCulture), out var item))
                || (title.ImdbId is { } imdb && byImdb.TryGetValue(imdb, out item)))
            {
                owned[i] = item;
            }
        }

        return owned;
    }

    private async Task<IReadOnlyList<HomeRowEntry>> FromTraktAsync(
        IReadOnlyList<TraktTitle> titles,
        (SeerrEndpoint Endpoint, int SeerrUserId)? caller,
        User user,
        int limit,
        long started,
        CancellationToken cancellationToken)
    {
        var owned = MatchOwned(titles, user);

        // The first titles that can have a card, a few spare in case a Seerr lookup fails or two titles are one item.
        var candidates = Enumerable.Range(0, titles.Count)
            .Where(i => owned.ContainsKey(i) || (caller is not null && titles[i].TmdbId is not null))
            .Take(limit + 4)
            .ToList();

        // Not disposed: lookups still running after the budget below keep using it (it holds no OS handle).
        var gate = new SemaphoreSlim(MaxConcurrentDetails);
        var lookups = candidates
            .Select(i => owned.TryGetValue(i, out var item)
                ? Task.FromResult<HomeRowEntry?>(HomeRowEntry.ForItem(item))
                : ResolveAsync(caller!.Value.Endpoint, caller.Value.SeerrUserId, titles[i].TmdbId!.Value, user, gate, cancellationToken))
            .ToList();
        var all = Task.WhenAll(lookups);
        var left = DetailsBudget - _time.GetElapsedTime(started);
        if (left > TimeSpan.Zero)
        {
            await Task.WhenAny(all, Task.Delay(left, _time, cancellationToken)).ConfigureAwait(false);
        }

        _ = all.ContinueWith(t => _ = t.Exception, CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);

        var seen = new HashSet<Guid>();
        return lookups
            .Where(t => t.IsCompletedSuccessfully)
            .Select(t => t.Result)
            .OfType<HomeRowEntry>()
            .Where(e => e.Item is null || seen.Add(e.Item.Id))
            .Take(limit)
            .ToList();
    }

    /// <summary>The card for a title the user can't watch here (yet), or null if Seerr couldn't give its details.</summary>
    private async Task<HomeRowEntry?> ResolveAsync(SeerrEndpoint endpoint, int seerrUserId, int tmdbId, User user, SemaphoreSlim gate, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        SeerrTitle title;
        try
        {
            title = await _seerr.GetTitleSummaryAsync(endpoint, seerrUserId, _mediaType, tmdbId, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException e)
        {
            if (!e.IsCircuitOpen && _logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug("Lumen's {Type} row skipped TMDB {MediaType} {TmdbId}: {Message}", Type, _mediaType, tmdbId, e.Message);
            }

            return null;
        }
        finally
        {
            gate.Release();
        }

        if (_mapper.ToItem(_mediaType, title, user, CatalogMapper.TitleGenreNames(title)) is not { } item)
        {
            return null;
        }

        // Seerr knows it's on the server where the library match didn't (an item without a TMDB or IMDb id, say).
        return _mapper.VisibleItem(item.JellyfinItemId, user) is { } visible ? HomeRowEntry.ForItem(visible) : HomeRowEntry.ForCatalog(item);
    }

    /// <summary>Seerr's trending titles of this row's type (TMDB's trending list, which mixes movies and shows).</summary>
    private async Task<IReadOnlyList<HomeRowEntry>> FromTrendingAsync(SeerrEndpoint endpoint, int seerrUserId, User user, int limit, CancellationToken cancellationToken)
    {
        try
        {
            var items = new List<CatalogItemDto>();
            for (var page = 1; page <= 2 && items.Count < limit; page++)
            {
                var results = await _seerr.DiscoverPageAsync(endpoint, seerrUserId, SeerrDiscoverList.Trending, page, cancellationToken).ConfigureAwait(false);
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
                _logger.LogDebug("Lumen dropped the {Type} row: {Message}", Type, e.Message);
            }

            return [];
        }
    }
}

/// <summary>Trakt's most watched movies this week.</summary>
public sealed class Top10MoviesProvider : Top10Provider
{
    public Top10MoviesProvider(
        ITop10Lists lists,
        CatalogRowAccess access,
        ISeerrClient seerr,
        CatalogMapper mapper,
        ILibraryManager library,
        TimeProvider time,
        ILogger<Top10MoviesProvider> logger)
        : base(TraktListKind.Movies, lists, access, seerr, mapper, library, time, logger)
    {
    }

    public override string Type => SectionTypes.Top10Movies;

    public override string DisplayName => "Top 10 Movies";

    public override string Description =>
        "The week's most watched movies on Trakt, ranked (Seerr's trending movies without a Trakt key); titles not on the server can be requested.";

    protected override string RowTitle => "Top 10 Movies This Week";
}

/// <summary>Trakt's most watched shows this week.</summary>
public sealed class Top10ShowsProvider : Top10Provider
{
    public Top10ShowsProvider(
        ITop10Lists lists,
        CatalogRowAccess access,
        ISeerrClient seerr,
        CatalogMapper mapper,
        ILibraryManager library,
        TimeProvider time,
        ILogger<Top10ShowsProvider> logger)
        : base(TraktListKind.Shows, lists, access, seerr, mapper, library, time, logger)
    {
    }

    public override string Type => SectionTypes.Top10Shows;

    public override string DisplayName => "Top 10 Shows";

    public override string Description =>
        "The week's most watched shows on Trakt, ranked (Seerr's trending shows without a Trakt key); titles not on the server can be requested.";

    protected override string RowTitle => "Top 10 Shows This Week";
}
