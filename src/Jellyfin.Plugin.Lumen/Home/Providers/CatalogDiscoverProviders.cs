using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>A row for one of Seerr's discover lists.</summary>
public abstract class CatalogDiscoverProvider : CatalogSectionProvider
{
    private readonly SeerrDiscoverList _list;
    private readonly string? _mediaType;

    protected CatalogDiscoverProvider(
        SeerrDiscoverList list, string? mediaType, CatalogRowAccess access, ISeerrClient seerr, CatalogMapper mapper, ILogger logger)
        : base(access, seerr, mapper, logger)
    {
        _list = list;
        _mediaType = mediaType;
    }

    protected override async Task<IReadOnlyList<CatalogItemDto>> GetItemsAsync(SeerrEndpoint endpoint, int seerrUserId, HomeContext context, CancellationToken cancellationToken)
    {
        var page = await Seerr.DiscoverAsync(endpoint, seerrUserId, _list, cancellationToken).ConfigureAwait(false);
        return Map(page.Results, _mediaType, context.User).Select(m => m.Item).ToList();
    }
}

/// <summary>Seerr's trending movies and shows (people are dropped).</summary>
public sealed class CatalogTrendingProvider : CatalogDiscoverProvider
{
    public CatalogTrendingProvider(CatalogRowAccess access, ISeerrClient seerr, CatalogMapper mapper, ILogger<CatalogTrendingProvider> logger)
        : base(SeerrDiscoverList.Trending, null, access, seerr, mapper, logger)
    {
    }

    public override string Type => SectionTypes.CatalogTrending;

    public override string DisplayName => "Trending";

    public override string Description => "Movies and shows trending this week, from Seerr; titles not on the server can be requested.";
}

/// <summary>Seerr's popular movies.</summary>
public sealed class CatalogPopularMoviesProvider : CatalogDiscoverProvider
{
    public CatalogPopularMoviesProvider(CatalogRowAccess access, ISeerrClient seerr, CatalogMapper mapper, ILogger<CatalogPopularMoviesProvider> logger)
        : base(SeerrDiscoverList.PopularMovies, CatalogMediaType.Movie, access, seerr, mapper, logger)
    {
    }

    public override string Type => SectionTypes.CatalogPopularMovies;

    public override string DisplayName => "Popular Movies";

    public override string Description => "Popular movies from Seerr, mixing ones on the server with ones the viewer can request.";
}

/// <summary>Seerr's popular shows.</summary>
public sealed class CatalogPopularShowsProvider : CatalogDiscoverProvider
{
    public CatalogPopularShowsProvider(CatalogRowAccess access, ISeerrClient seerr, CatalogMapper mapper, ILogger<CatalogPopularShowsProvider> logger)
        : base(SeerrDiscoverList.PopularTv, CatalogMediaType.Tv, access, seerr, mapper, logger)
    {
    }

    public override string Type => SectionTypes.CatalogPopularShows;

    public override string DisplayName => "Popular Shows";

    public override string Description => "Popular shows from Seerr, mixing ones on the server with ones the viewer can request.";
}
