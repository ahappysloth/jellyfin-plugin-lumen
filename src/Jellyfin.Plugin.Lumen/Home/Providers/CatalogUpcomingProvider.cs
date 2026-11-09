using System.Globalization;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>Upcoming movies and shows merged, soonest first; titles without a date go last.</summary>
public sealed class CatalogUpcomingProvider : CatalogSectionProvider
{
    public CatalogUpcomingProvider(CatalogRowAccess access, ISeerrClient seerr, CatalogMapper mapper, ILogger<CatalogUpcomingProvider> logger)
        : base(access, seerr, mapper, logger)
    {
    }

    public override string Type => SectionTypes.CatalogUpcoming;

    public override string DisplayName => "Coming Soon";

    public override string Description => "Upcoming movies and shows from Seerr, soonest first, ready to request ahead of release.";

    /// <summary>A "YYYY-MM-DD" date, or null.</summary>
    internal static DateOnly? ParseDate(string? date) =>
        DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed) ? parsed : null;

    protected override async Task<IReadOnlyList<CatalogItemDto>> GetItemsAsync(SeerrEndpoint endpoint, int seerrUserId, HomeContext context, CancellationToken cancellationToken)
    {
        var movies = Seerr.DiscoverAsync(endpoint, seerrUserId, SeerrDiscoverList.UpcomingMovies, cancellationToken);
        var shows = Seerr.DiscoverAsync(endpoint, seerrUserId, SeerrDiscoverList.UpcomingTv, cancellationToken);
        var pages = await Task.WhenAll(movies, shows).ConfigureAwait(false);
        return Map(pages[0].Results, CatalogMediaType.Movie, context.User)
            .Concat(Map(pages[1].Results, CatalogMediaType.Tv, context.User))
            .Select(m => (m.Item, Date: ParseDate(m.Item.MediaType == CatalogMediaType.Tv ? m.Media.FirstAirDate : m.Media.ReleaseDate)))
            .OrderBy(m => m.Date is null)
            .ThenBy(m => m.Date)
            .Select(m => m.Item)
            .ToList();
    }
}
