using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Reads a user's recent plays.</summary>
public interface IWatchHistoryService
{
    Task<WatchHistory> GetAsync(User user, DateTimeOffset now, CancellationToken cancellationToken);
}

/// <summary>Recent plays within <see cref="Window"/>, most recent first. Episodes use their series' genres.</summary>
public sealed class WatchHistoryService : IWatchHistoryService
{
    public const int MaxItems = 200;
    public static readonly TimeSpan Window = TimeSpan.FromDays(90);

    private readonly ILibraryManager _libraryManager;
    private readonly IUserDataManager _userDataManager;

    public WatchHistoryService(ILibraryManager libraryManager, IUserDataManager userDataManager)
    {
        _libraryManager = libraryManager;
        _userDataManager = userDataManager;
    }

    public Task<WatchHistory> GetAsync(User user, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var items = _libraryManager.GetItemList(new InternalItemsQuery(user)
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Episode],
            Recursive = true,
            IsVirtualItem = false,
            OrderBy = [(ItemSortBy.DatePlayed, SortOrder.Descending)],
            Limit = MaxItems,
            DtoOptions = QueryOptions.Full(),
        });
        if (items.Count == 0)
        {
            return Task.FromResult(WatchHistory.Empty);
        }

        cancellationToken.ThrowIfCancellationRequested();
        var userData = _userDataManager.GetUserDataBatch(items, user);
        var cutoff = now.UtcDateTime - Window;
        var played = items
            .Select(item => (Item: item, LastPlayed: userData.GetValueOrDefault(item.Id)?.LastPlayedDate))
            .Where(x => x.LastPlayed is { } at && at >= cutoff)
            .ToList();

        var seriesIds = played.Select(x => x.Item).OfType<Episode>().Select(e => e.SeriesId).Where(id => id != Guid.Empty).Distinct().ToArray();
        var seriesById = seriesIds.Length == 0
            ? new Dictionary<Guid, BaseItem>()
            : _libraryManager.GetItemList(new InternalItemsQuery(user) { ItemIds = seriesIds, DtoOptions = QueryOptions.Full() })
                .ToDictionary(s => s.Id);

        var entries = played.Select(x => x.Item is Episode episode
                ? new WatchedEntry(episode, episode.SeriesId, episode.SeriesName, seriesById.GetValueOrDefault(episode.SeriesId)?.Genres ?? [], x.LastPlayed!.Value)
                : new WatchedEntry(x.Item, null, null, x.Item.Genres ?? [], x.LastPlayed!.Value))
            .ToList();

        return Task.FromResult(new WatchHistory(entries));
    }
}
