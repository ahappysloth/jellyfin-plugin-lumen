using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// Recently added, unplayed: (a) new episodes of shows the user has been watching (shown as the series) and
/// (b) new movies in the user's top three genres. "Watching" means the show appears in the 90-day watch history.
/// </summary>
public sealed class NewForYouProvider : IHomeSectionProvider
{
    private const int EpisodeScanLimit = 200;
    private readonly ILibraryManager _libraryManager;

    public NewForYouProvider(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public string Type => SectionTypes.NewForYou;

    public string DisplayName => "New For You";

    public IReadOnlyList<SectionParameter> Parameters { get; } =
        [new SectionParameter("days", "Look back (days)", SectionParameterKind.Integer, DefaultValue: "14", Min: 1, Max: 90)];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public async Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var since = context.Now.UtcDateTime.AddDays(-definition.GetIntParam("days", 14));
        var history = await context.GetWatchHistoryAsync();
        var candidates = new List<(BaseItem Item, DateTime Added)>();

        var watchedSeries = history.Entries.Where(e => e.SeriesId is not null).Select(e => e.SeriesId!.Value).ToHashSet();
        if (watchedSeries.Count > 0)
        {
            var newest = _libraryManager.GetItemList(new InternalItemsQuery(context.User)
                {
                    IncludeItemTypes = [BaseItemKind.Episode],
                    Recursive = true,
                    IsPlayed = false,
                    IsVirtualItem = false,
                    MinDateCreated = since,
                    OrderBy = [(ItemSortBy.DateCreated, SortOrder.Descending)],
                    Limit = EpisodeScanLimit,
                    DtoOptions = QueryOptions.IdsOnly(),
                })
                .OfType<Episode>()
                .Where(e => watchedSeries.Contains(e.SeriesId))
                .GroupBy(e => e.SeriesId)
                .Select(g => (SeriesId: g.Key, Added: g.Max(e => e.DateCreated)))
                .ToList();

            if (newest.Count > 0)
            {
                var series = _libraryManager.GetItemList(new InternalItemsQuery(context.User)
                    {
                        ItemIds = newest.Select(n => n.SeriesId).ToArray(),
                        DtoOptions = QueryOptions.Full(),
                    })
                    .ToDictionary(s => s.Id);
                candidates.AddRange(newest.Where(n => series.ContainsKey(n.SeriesId)).Select(n => (series[n.SeriesId], n.Added)));
            }
        }

        var topGenres = GenreWeighting.TopGenres(GenreWeighting.Compute(history.Entries, history.Entries.SelectMany(e => e.Genres)), 3);
        if (topGenres.Count > 0)
        {
            var movies = _libraryManager.GetItemList(new InternalItemsQuery(context.User)
            {
                IncludeItemTypes = [BaseItemKind.Movie],
                Recursive = true,
                IsPlayed = false,
                IsVirtualItem = false,
                MinDateCreated = since,
                Genres = topGenres.ToArray(),
                OrderBy = [(ItemSortBy.DateCreated, SortOrder.Descending)],
                Limit = context.ItemLimit,
                DtoOptions = QueryOptions.Full(),
            });
            candidates.AddRange(movies.Select(m => (m, m.DateCreated)));
        }

        return HomeRow.Single(definition, DisplayName, Merge(candidates, context.ItemLimit));
    }

    internal static IReadOnlyList<BaseItem> Merge(IEnumerable<(BaseItem Item, DateTime Added)> candidates, int limit) =>
        candidates.OrderByDescending(c => c.Added).Select(c => c.Item).DistinctBy(i => i.Id).Take(limit).ToList();
}
