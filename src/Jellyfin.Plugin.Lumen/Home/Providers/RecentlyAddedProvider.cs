using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
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

    public string Description => "The newest movies and shows on the server, or in one library; new episodes appear as their show.";

    public IReadOnlyList<SectionParameter> Parameters { get; } =
        [new SectionParameter("libraryId", "Library (empty = all libraries)", SectionParameterKind.Library)];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        // The newest items are only read for their ids and series ids, so this scan skips images, user data and
        // provider ids. Only the cards that are shown are loaded in full, below.
        var query = new InternalItemsQuery(context.User)
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Episode],
            Recursive = true,
            IsVirtualItem = false,
            OrderBy = [(ItemSortBy.DateCreated, SortOrder.Descending)],
            Limit = context.ItemLimit * OverFetchFactor,
            DtoOptions = QueryOptions.IdsOnly(),
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

        var cardIds = CardIds(_libraryManager.GetItemList(query));
        return Task.FromResult(HomeRow.Single(definition, DisplayName, LoadCards(context, cardIds)));
    }

    /// <summary>The card for each item, newest first: a movie is its own card, an episode is its series.</summary>
    internal static IReadOnlyList<Guid> CardIds(IReadOnlyList<BaseItem> items) =>
        items.Select(item => item is Episode episode ? episode.SeriesId : item.Id)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToList();

    /// <summary>
    /// Loads the first <see cref="HomeContext.ItemLimit"/> cards the user can see, in <paramref name="cardIds"/> order.
    /// A card the user cannot see (a series hidden by parental controls, say) is skipped and the next one fills in:
    /// usually the first query is enough; if not, the remaining candidates are loaded in one more.
    /// </summary>
    private List<BaseItem> LoadCards(HomeContext context, IReadOnlyList<Guid> cardIds)
    {
        var limit = context.ItemLimit;
        var cards = Load(context.User, cardIds.Take(limit).ToArray());
        if (cards.Count < limit && cardIds.Count > limit)
        {
            cards.AddRange(Load(context.User, cardIds.Skip(limit).ToArray()).Take(limit - cards.Count));
        }

        return cards;
    }

    private List<BaseItem> Load(User user, Guid[] ids)
    {
        if (ids.Length == 0)
        {
            return [];
        }

        var byId = _libraryManager.GetItemList(new InternalItemsQuery(user) { ItemIds = ids, DtoOptions = QueryOptions.Full() })
            .ToDictionary(i => i.Id);
        return ids.Where(byId.ContainsKey).Select(id => byId[id]).ToList();
    }
}
