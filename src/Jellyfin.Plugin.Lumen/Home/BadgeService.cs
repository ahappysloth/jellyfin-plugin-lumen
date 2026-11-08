using System.Globalization;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Computes card badges for the items on a home response.</summary>
public interface IBadgeService
{
    /// <summary>Returns item id (Guid "N" format) → <see cref="CardBadges"/> key, for the items that have a badge.</summary>
    IReadOnlyDictionary<string, string> GetBadges(HomeContext context, IEnumerable<BaseItem> items);
}

/// <summary>Badge keys a home card can carry (values of <c>HomeResponseDto.Badges</c>).</summary>
public static class CardBadges
{
    public const string RecentlyAdded = "RecentlyAdded";
    public const string NewEpisode = "NewEpisode";
    public const string NewSeason = "NewSeason";
}

/// <summary>
/// Movies and episodes added within <see cref="Window"/> are "RecentlyAdded", as are series that were. A series that
/// gained media within the window is "NewSeason" when its newest episode opens a later season, else "NewEpisode".
/// Other item types (genres, folders, …) get no badge.
/// </summary>
public sealed class BadgeService : IBadgeService
{
    public static readonly TimeSpan Window = TimeSpan.FromDays(7);

    private readonly ILibraryManager _libraryManager;

    public BadgeService(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public IReadOnlyDictionary<string, string> GetBadges(HomeContext context, IEnumerable<BaseItem> items)
    {
        var cutoff = context.Now.UtcDateTime - Window;
        var badges = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var item in items.DistinctBy(i => i.Id))
        {
            if (Badge(context, item, cutoff) is { } badge)
            {
                badges[item.Id.ToString("N", CultureInfo.InvariantCulture)] = badge;
            }
        }

        return badges;
    }

    private string? Badge(HomeContext context, BaseItem item, DateTime cutoff) => item switch
    {
        Movie or Episode => item.DateCreated >= cutoff ? CardBadges.RecentlyAdded : null,
        Series series when series.DateCreated >= cutoff => CardBadges.RecentlyAdded,
        Series series when series.DateLastMediaAdded >= cutoff => SeriesBadge(context, series),
        _ => null,
    };

    private string? SeriesBadge(HomeContext context, Series series)
    {
        var episodes = _libraryManager.GetItemList(new InternalItemsQuery(context.User)
        {
            IncludeItemTypes = [BaseItemKind.Episode],
            AncestorIds = [series.Id],
            Recursive = true,
            IsVirtualItem = false,
            OrderBy = [(ItemSortBy.DateCreated, SortOrder.Descending)],
            Limit = 1,
            DtoOptions = QueryOptions.Full(),
        });

        // No episode the user can see: the new media is not theirs to be told about.
        if (episodes.Count == 0)
        {
            return null;
        }

        var newest = episodes[0];
        return newest.IndexNumber == 1 && newest.ParentIndexNumber > 1 ? CardBadges.NewSeason : CardBadges.NewEpisode;
    }
}
