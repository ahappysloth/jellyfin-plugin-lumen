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

    /// <summary>
    /// How many of the window's newest episodes one query reads for all the series at once. A series whose newest
    /// episode falls outside them (a bulk import) is looked up on its own.
    /// </summary>
    internal const int EpisodeScanLimit = 500;

    private readonly ILibraryManager _libraryManager;

    public BadgeService(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public IReadOnlyDictionary<string, string> GetBadges(HomeContext context, IEnumerable<BaseItem> items)
    {
        var cutoff = context.Now.UtcDateTime - Window;
        var badges = new Dictionary<string, string>(StringComparer.Ordinal);
        var updatedSeries = new List<Series>();
        foreach (var item in items.DistinctBy(i => i.Id))
        {
            if (item is Series { DateLastMediaAdded: { } added } series && series.DateCreated < cutoff && added >= cutoff)
            {
                updatedSeries.Add(series);
            }
            else if (Badge(item, cutoff) is { } badge)
            {
                badges[Key(item)] = badge;
            }
        }

        if (updatedSeries.Count > 0)
        {
            var newest = NewestEpisodes(context, updatedSeries, cutoff);
            foreach (var series in updatedSeries)
            {
                // No episode the user can see in the window: the new media is not theirs to be told about.
                if (newest.TryGetValue(series.Id, out var episode))
                {
                    badges[Key(series)] = episode.IndexNumber == 1 && episode.ParentIndexNumber > 1 ? CardBadges.NewSeason : CardBadges.NewEpisode;
                }
            }
        }

        return badges;
    }

    private static string Key(BaseItem item) => item.Id.ToString("N", CultureInfo.InvariantCulture);

    private static string? Badge(BaseItem item, DateTime cutoff) => item switch
    {
        Movie or Episode or Series => item.DateCreated >= cutoff ? CardBadges.RecentlyAdded : null,
        _ => null,
    };

    /// <summary>Each series' newest episode added within the window that the user can see, in one query where it can.</summary>
    private Dictionary<Guid, Episode> NewestEpisodes(HomeContext context, IReadOnlyList<Series> series, DateTime cutoff)
    {
        var episodes = Episodes(context, series.Select(s => s.Id).ToArray(), cutoff, EpisodeScanLimit);
        var newest = new Dictionary<Guid, Episode>();
        foreach (var episode in episodes.OfType<Episode>())
        {
            // Newest first, so the first one seen for a series is its newest.
            newest.TryAdd(episode.SeriesId, episode);
        }

        if (episodes.Count >= EpisodeScanLimit)
        {
            foreach (var missing in series.Where(s => !newest.ContainsKey(s.Id)))
            {
                if (Episodes(context, [missing.Id], cutoff, 1).OfType<Episode>().FirstOrDefault() is { } episode)
                {
                    newest[missing.Id] = episode;
                }
            }
        }

        return newest;
    }

    private IReadOnlyList<BaseItem> Episodes(HomeContext context, Guid[] seriesIds, DateTime cutoff, int limit) =>
        _libraryManager.GetItemList(new InternalItemsQuery(context.User)
        {
            IncludeItemTypes = [BaseItemKind.Episode],
            AncestorIds = seriesIds,
            Recursive = true,
            IsVirtualItem = false,
            MinDateCreated = cutoff,
            OrderBy = [(ItemSortBy.DateCreated, SortOrder.Descending)],
            Limit = limit,
            DtoOptions = QueryOptions.Full(),
        });
}
