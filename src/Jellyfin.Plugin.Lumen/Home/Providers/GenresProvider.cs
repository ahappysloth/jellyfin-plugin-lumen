using System.Collections.Concurrent;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// One row of genre tiles: the genres with the most of the user's movies and shows (optionally limited to one
/// library), listed alphabetically.
/// Each tile borrows the backdrop of one of the genre's top-rated movies or shows (see
/// <see cref="HomeRow.BackdropSources"/>), and no two tiles borrow the same title's, a show counting once whatever its
/// seasons and episodes, unless a genre has nothing else left (<see cref="AssignBackdrops"/>).
/// <para>
/// Ranking takes one count query per genre, so the ranking is cached per user and library until the library changes
/// (<see cref="HomeCache.LibraryGeneration"/>), or for at most <see cref="RankingTtl"/> (a user's access can change too).
/// </para>
/// </summary>
public sealed class GenresProvider : IHomeSectionProvider
{
    public const int MaxGenres = 12;

    /// <summary>
    /// How many of a genre's top-rated titles its tile may borrow from: with every other tile taking one title, one is
    /// still free.
    /// </summary>
    public const int BackdropCandidates = MaxGenres;
    public static readonly TimeSpan RankingTtl = TimeSpan.FromHours(1);

    /// <summary>More cached rankings than this and the cache starts over.</summary>
    private const int MaxRankings = 1000;

    private static readonly BaseItemKind[] TitleKinds = [BaseItemKind.Movie, BaseItemKind.Series];
    private readonly ConcurrentDictionary<(Guid User, Guid? Library), Ranking> _rankings = new();
    private readonly ILibraryManager _libraryManager;
    private readonly HomeCache _library;
    private readonly TimeProvider _time;

    public GenresProvider(ILibraryManager libraryManager, HomeCache library, TimeProvider time)
    {
        _libraryManager = libraryManager;
        _library = library;
        _time = time;
    }

    public string Type => SectionTypes.Genres;

    public string DisplayName => "Popular Genres";

    public string Description => "Tiles for the most common genres, A to Z; each opens that genre's titles.";

    public IReadOnlyList<SectionParameter> Parameters { get; } =
        [new SectionParameter("libraryId", "Library (empty = all libraries)", SectionParameterKind.Library)];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var libraryId = definition.GetGuidParam("libraryId");

        // Visibility check: returns null when the user cannot access the library.
        if (libraryId is { } id && _libraryManager.GetItemById<Folder>(id, context.User) is null)
        {
            return Task.FromResult<IReadOnlyList<HomeRow>>([]);
        }

        var genres = TopGenres(context, libraryId, cancellationToken);
        if (genres.Count == 0)
        {
            return Task.FromResult<IReadOnlyList<HomeRow>>([]);
        }

        var backdrops = AssignBackdrops(
            genres,
            genre =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                return Representatives(context, libraryId, genre, TitleKinds);
            },
            genre =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                return Representatives(context, libraryId, genre, []);
            });

        IReadOnlyList<HomeRow> rows =
            [new HomeRow(HomeRow.RowId(definition, 0), Type, definition.Title ?? DisplayName, genres) { BackdropSources = backdrops }];
        return Task.FromResult(rows);
    }

    /// <summary>
    /// Picks each genre's backdrop source so that no title shows on two tiles. Each genre offers its top-rated titles
    /// (<paramref name="titles"/>), else, once none of those is free, its top-rated items of any kind
    /// (<paramref name="anything"/>, asked only then). A title is a movie, or a show with its seasons and episodes (an
    /// episode's backdrop is still its show's title), so no show fills three tiles through its episodes.
    /// <para>
    /// The genres with the fewest titles choose first, A to Z among equals, each its best-rated free title. One that
    /// finds them all taken asks the genres holding them to move to another free title of theirs, and so on down the
    /// line (a matching's augmenting path; at most <see cref="MaxGenres"/> genres, so it costs nothing): so a title
    /// repeats only when no way of sharing them out avoids it, and then it's the genre's own top-rated one. The same
    /// library always gives the same choice: the queries are sorted, and so is the order genres choose in.
    /// </para>
    /// </summary>
    internal static Dictionary<Guid, BaseItem> AssignBackdrops(
        IReadOnlyList<BaseItem> genres,
        Func<BaseItem, IReadOnlyList<BaseItem>> titles,
        Func<BaseItem, IReadOnlyList<BaseItem>> anything)
    {
        var offered = genres
            .Select(g => (Genre: g, Titles: titles(g)))
            .OrderBy(o => o.Titles.Select(TitleKey).Distinct().Count())
            .ThenBy(o => o.Genre.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var holder = new Dictionary<Guid, int>(); // title → the genre (index in offered) showing it
        var picks = new BaseItem?[offered.Count];

        bool Take(int genre, HashSet<int> moved)
        {
            foreach (var candidate in offered[genre].Titles)
            {
                var key = TitleKey(candidate);
                if (!holder.TryGetValue(key, out var other)
                    || (other != genre && moved.Add(other) && Take(other, moved)))
                {
                    holder[key] = genre;
                    picks[genre] = candidate;
                    return true;
                }
            }

            return false;
        }

        for (var genre = 0; genre < offered.Count; genre++)
        {
            Take(genre, [genre]);
        }

        var result = new Dictionary<Guid, BaseItem>();
        for (var genre = 0; genre < offered.Count; genre++)
        {
            var (item, candidates) = offered[genre];
            if (picks[genre] is null)
            {
                // Nothing of its own titles left: something else of the genre's that's free, else a repeat.
                var others = anything(item);
                var free = others.FirstOrDefault(c => !holder.ContainsKey(TitleKey(c)));
                if (free is not null)
                {
                    holder[TitleKey(free)] = genre;
                }

                picks[genre] = free ?? (candidates.Count > 0 ? candidates[0] : others.Count > 0 ? others[0] : null);
            }

            if (picks[genre] is { } pick)
            {
                result[item.Id] = pick;
            }
        }

        return result;
    }

    /// <summary>What counts as one title: a show for its seasons and episodes, else the item itself.</summary>
    internal static Guid TitleKey(BaseItem item) =>
        item is IHasSeries { SeriesId: var series } && series != Guid.Empty ? series : item.Id;

    private static InternalItemsQuery ForGenre(InternalItemsQuery query, BaseItem genre)
    {
        query.GenreIds = [genre.Id];
        return query;
    }

    private static InternalItemsQuery Query(HomeContext context, Guid? libraryId, BaseItemKind[] kinds, DtoOptions options)
    {
        var query = new InternalItemsQuery(context.User)
        {
            IncludeItemTypes = kinds,
            Recursive = true,
            IsVirtualItem = false,
            DtoOptions = options,
        };
        if (libraryId is { } id)
        {
            query.ParentId = id;
        }

        return query;
    }

    /// <summary>The user's <see cref="MaxGenres"/> most common genres, A to Z; cached (see the class remarks).</summary>
    private IReadOnlyList<BaseItem> TopGenres(HomeContext context, Guid? libraryId, CancellationToken cancellationToken)
    {
        var key = (context.User.Id, libraryId);
        var generation = _library.LibraryGeneration; // read first, so a change while counting isn't cached as current
        var now = _time.GetUtcNow();
        if (_rankings.TryGetValue(key, out var cached) && cached.Generation == generation && cached.Expires > now)
        {
            return cached.Genres;
        }

        // Genres of the user's accessible movies and shows, ranked by one cheap count query per genre (not a scan of
        // every title). The genres are displayed, so they load fully.
        var counted = new List<(BaseItem Genre, int Count)>();
        foreach (var genre in _libraryManager.GetGenres(Query(context, libraryId, TitleKinds, QueryOptions.Full())).Items.Select(g => g.Item))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!string.IsNullOrWhiteSpace(genre.Name))
            {
                counted.Add((genre, _libraryManager.GetCount(ForGenre(Query(context, libraryId, TitleKinds, QueryOptions.IdsOnly()), genre))));
            }
        }

        var top = counted
            .Where(g => g.Count > 0)
            .OrderByDescending(g => g.Count)
            .ThenBy(g => g.Genre.Name, StringComparer.OrdinalIgnoreCase)
            .Take(MaxGenres)
            .Select(g => g.Genre)
            .OrderBy(g => g.Name, StringComparer.CurrentCultureIgnoreCase) // the most popular genres, shown A to Z
            .ToList();
        if (_rankings.Count >= MaxRankings)
        {
            _rankings.Clear();
        }

        _rankings[key] = new Ranking(generation, now + RankingTtl, top);
        return top;
    }

    /// <summary>The genre's highest-rated items (of <paramref name="kinds"/>; empty = any) that have a backdrop.</summary>
    private List<BaseItem> Representatives(HomeContext context, Guid? libraryId, BaseItem genre, BaseItemKind[] kinds)
    {
        var query = ForGenre(Query(context, libraryId, kinds, QueryOptions.Full()), genre);
        query.ImageTypes = [ImageType.Backdrop];
        query.OrderBy = [(ItemSortBy.CommunityRating, SortOrder.Descending), (ItemSortBy.SortName, SortOrder.Ascending)];
        query.Limit = BackdropCandidates;
        return _libraryManager.GetItemList(query).Where(i => i.HasImage(ImageType.Backdrop, 0)).ToList();
    }

    private sealed record Ranking(long Generation, DateTimeOffset Expires, IReadOnlyList<BaseItem> Genres);
}
