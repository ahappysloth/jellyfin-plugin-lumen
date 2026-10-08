using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>Movies and episodes the user started but did not finish.</summary>
public sealed class ContinueWatchingProvider : IHomeSectionProvider
{
    private readonly ILibraryManager _libraryManager;

    public ContinueWatchingProvider(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public string Type => SectionTypes.ContinueWatching;

    public string DisplayName => "Continue Watching";

    public IReadOnlyList<SectionParameter> Parameters => [];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var items = _libraryManager.GetItemList(new InternalItemsQuery(context.User)
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Episode],
            IsResumable = true,
            Recursive = true,
            IsVirtualItem = false,
            CollapseBoxSetItems = false,
            OrderBy = [(ItemSortBy.DatePlayed, SortOrder.Descending)],
            Limit = context.ItemLimit,
            DtoOptions = QueryOptions.Full(),
        });

        return Task.FromResult(HomeRow.Single(definition, DisplayName, items));
    }
}
