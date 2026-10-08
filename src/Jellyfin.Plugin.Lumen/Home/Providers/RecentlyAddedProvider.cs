using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>Newest movies and shows, optionally limited to one library. New episodes appear as their series.</summary>
public sealed class RecentlyAddedProvider : IHomeSectionProvider
{
    private const int OverFetchFactor = 5;
    private readonly ILibraryManager _libraryManager;

    public RecentlyAddedProvider(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public string Type => SectionTypes.RecentlyAdded;

    public string DisplayName => "Recently Added";

    public IReadOnlyList<SectionParameter> Parameters { get; } =
        [new SectionParameter("libraryId", "Library (empty = all libraries)", SectionParameterKind.Library)];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var query = new InternalItemsQuery(context.User)
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Episode],
            Recursive = true,
            IsVirtualItem = false,
            OrderBy = [(ItemSortBy.DateCreated, SortOrder.Descending)],
            Limit = context.ItemLimit * OverFetchFactor,
            DtoOptions = QueryOptions.Full(),
        };

        if (definition.GetGuidParam("libraryId") is { } libraryId)
        {
            // Visibility check: returns null when the user cannot access the library.
            if (_libraryManager.GetItemById<Folder>(libraryId, context.User) is null)
            {
                return Task.FromResult<IReadOnlyList<HomeRow>>([]);
            }

            query.ParentId = libraryId;
        }

        var items = _libraryManager.GetItemList(query);
        var seriesIds = items.OfType<Episode>().Select(e => e.SeriesId).Where(id => id != Guid.Empty).Distinct().ToArray();
        var seriesById = seriesIds.Length == 0
            ? new Dictionary<Guid, BaseItem>()
            : _libraryManager.GetItemList(new InternalItemsQuery(context.User) { ItemIds = seriesIds, DtoOptions = QueryOptions.Full() })
                .ToDictionary(s => s.Id);

        return Task.FromResult(HomeRow.Single(definition, DisplayName, Group(items, seriesById, context.ItemLimit)));
    }

    internal static IReadOnlyList<BaseItem> Group(IReadOnlyList<BaseItem> items, IReadOnlyDictionary<Guid, BaseItem> seriesById, int limit)
    {
        var seen = new HashSet<Guid>();
        var result = new List<BaseItem>();
        foreach (var item in items)
        {
            var card = item is Episode episode ? seriesById.GetValueOrDefault(episode.SeriesId) : item;
            if (card is null || !seen.Add(card.Id))
            {
                continue;
            }

            result.Add(card);
            if (result.Count == limit)
            {
                break;
            }
        }

        return result;
    }
}
