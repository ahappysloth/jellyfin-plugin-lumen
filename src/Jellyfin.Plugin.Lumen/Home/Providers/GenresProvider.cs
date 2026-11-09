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
/// Each tile borrows the backdrop of the genre's top-rated movie or show (see <see cref="HomeRow.BackdropSources"/>).
/// <para>
/// Ranking takes one count query per genre, so the ranking is cached per user and library until the library changes
/// (<see cref="HomeCache.LibraryGeneration"/>), or for at most <see cref="RankingTtl"/> (a user's access can change too).
/// </para>
/// </summary>
public sealed class GenresProvider : IHomeSectionProvider
{
    public const int MaxGenres = 12;
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

        var backdrops = new Dictionary<Guid, BaseItem>();
        foreach (var genre in genres)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if ((Representative(context, libraryId, genre, TitleKinds) ?? Representative(context, libraryId, genre, [])) is { } source)
            {
                backdrops[genre.Id] = source;
            }
        }

        IReadOnlyList<HomeRow> rows =
            [new HomeRow(HomeRow.RowId(definition, 0), Type, definition.Title ?? DisplayName, genres) { BackdropSources = backdrops }];
        return Task.FromResult(rows);
    }

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

    /// <summary>The genre's highest-rated item (of <paramref name="kinds"/>; empty = any) that has a backdrop.</summary>
    private BaseItem? Representative(HomeContext context, Guid? libraryId, BaseItem genre, BaseItemKind[] kinds)
    {
        var query = ForGenre(Query(context, libraryId, kinds, QueryOptions.Full()), genre);
        query.ImageTypes = [ImageType.Backdrop];
        query.OrderBy = [(ItemSortBy.CommunityRating, SortOrder.Descending), (ItemSortBy.SortName, SortOrder.Ascending)];
        query.Limit = 1;
        return _libraryManager.GetItemList(query).FirstOrDefault(i => i.HasImage(ImageType.Backdrop, 0));
    }

    private sealed record Ranking(long Generation, DateTimeOffset Expires, IReadOnlyList<BaseItem> Genres);
}
