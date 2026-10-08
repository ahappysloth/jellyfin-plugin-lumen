using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// Daily-rotating genre rows weighted toward what the user watches. Candidates are the top-rated unplayed movies and
/// shows, so a genre is only picked when it has something to show. Rows are titled with the genre name.
/// </summary>
public sealed class GenreProvider : IHomeSectionProvider
{
    private const int CandidateLimit = 500;
    private const int PoolPerGenre = 40;
    private readonly ILibraryManager _libraryManager;

    public GenreProvider(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public string Type => SectionTypes.Genre;

    public string DisplayName => "Genre rows";

    public IReadOnlyList<SectionParameter> Parameters { get; } =
        [new SectionParameter("genreCount", "Number of genre rows", SectionParameterKind.Integer, DefaultValue: "3", Min: 1, Max: 6)];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public async Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var candidates = _libraryManager.GetItemList(new InternalItemsQuery(context.User)
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Series],
            Recursive = true,
            IsPlayed = false,
            IsVirtualItem = false,
            OrderBy = [(ItemSortBy.CommunityRating, SortOrder.Descending)],
            Limit = CandidateLimit,
            DtoOptions = QueryOptions.Full(),
        });
        if (candidates.Count == 0)
        {
            return [];
        }

        var history = await context.GetWatchHistoryAsync();
        var weights = GenreWeighting.Compute(history.Entries, candidates.SelectMany(c => c.Genres ?? []));
        var seed = GenreWeighting.DailySeed(context.User.Id, context.Now);
        var genres = GenreWeighting.Pick(weights, definition.GetIntParam("genreCount", 3), seed);

        var rows = new List<HomeRow>();
        for (var i = 0; i < genres.Count; i++)
        {
            var genre = genres[i];
            var pool = candidates.Where(c => (c.Genres ?? []).Contains(genre, StringComparer.OrdinalIgnoreCase)).Take(PoolPerGenre).ToList();
            var items = GenreWeighting.SeededShuffle(pool, unchecked(seed + i)).Take(context.ItemLimit).ToList();
            if (items.Count > 0)
            {
                rows.Add(new HomeRow(HomeRow.RowId(definition, i), Type, genre, items));
            }
        }

        return rows;
    }
}
