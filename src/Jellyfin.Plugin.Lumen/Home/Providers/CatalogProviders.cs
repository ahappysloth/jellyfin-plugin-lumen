using System.Globalization;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Entities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// Who may see catalog rows, and as which Seerr user. The user map and config store are resolved on first use, because
/// the config store's validator depends on every section provider (resolving them eagerly would be a cycle).
/// </summary>
public sealed class CatalogRowAccess
{
    private readonly Lazy<ISeerrUserMap> _users;
    private readonly Lazy<ILumenConfigStore> _config;

    public CatalogRowAccess(IServiceProvider services)
    {
        _users = new Lazy<ISeerrUserMap>(services.GetRequiredService<ISeerrUserMap>);
        _config = new Lazy<ILumenConfigStore>(services.GetRequiredService<ILumenConfigStore>);
    }

    internal CatalogRowAccess(ISeerrUserMap users, ILumenConfigStore config)
    {
        _users = new Lazy<ISeerrUserMap>(users);
        _config = new Lazy<ILumenConfigStore>(config);
    }

    /// <summary>The Seerr endpoint and the user's Seerr id, or null when the user has no catalog access.</summary>
    public async Task<(SeerrEndpoint Endpoint, int SeerrUserId)?> GetAsync(Guid jellyfinUserId, CancellationToken cancellationToken)
    {
        var access = await _users.Value.GetAccessAsync(jellyfinUserId, cancellationToken).ConfigureAwait(false);
        return access.Enabled && access.SeerrUserId is { } seerrUserId && SeerrEndpoint.From(_config.Value.Current) is { } endpoint
            ? (endpoint, seerrUserId)
            : null;
    }
}

/// <summary>
/// Base for the Seerr-backed rows (requests design spec, §5.1). Only users with catalog access get a row; any Seerr
/// failure drops the row quietly. Titles the user can already watch become their real Jellyfin item, so they render
/// as normal playable cards; the rest are catalog cards.
/// </summary>
public abstract class CatalogSectionProvider : IHomeSectionProvider
{
    /// <summary>
    /// Longer than <see cref="SeerrClient.Timeout"/>, so a hung Seerr fails the call (and counts towards the circuit
    /// breaker) before the home guard abandons the row; a cold My Requests also needs a detail call per title.
    /// </summary>
    public static readonly TimeSpan RowTimeout = SeerrClient.Timeout + TimeSpan.FromSeconds(1);

    private readonly CatalogRowAccess _access;
    private readonly ILogger _logger;

    protected CatalogSectionProvider(CatalogRowAccess access, ISeerrClient seerr, CatalogMapper mapper, ILogger logger)
    {
        _access = access;
        Seerr = seerr;
        Mapper = mapper;
        _logger = logger;
    }

    public abstract string Type { get; }

    public abstract string DisplayName { get; }

    public abstract string Description { get; }

    public IReadOnlyList<SectionParameter> Parameters => [];

    public TimeSpan? Timeout => RowTimeout;

    protected ISeerrClient Seerr { get; }

    protected CatalogMapper Mapper { get; }

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public async Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        if (await _access.GetAsync(context.User.Id, cancellationToken).ConfigureAwait(false) is not { } caller)
        {
            return [];
        }

        var (endpoint, seerrUserId) = caller;

        IReadOnlyList<CatalogItemDto> items;
        try
        {
            items = await GetItemsAsync(endpoint, seerrUserId, context, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException e)
        {
            // Fail open: the row just disappears. The breaker already logs outages once.
            if (!e.IsCircuitOpen && _logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug("Lumen dropped the {Type} row: {Message}", Type, e.Message);
            }

            return [];
        }

        return HomeRow.Catalog(definition, DisplayName, ToEntries(items, context.User).Take(context.ItemLimit).ToList());
    }

    /// <summary>The row's titles in display order (at least <see cref="HomeContext.ItemLimit"/> if there are that many).</summary>
    protected abstract Task<IReadOnlyList<CatalogItemDto>> GetItemsAsync(SeerrEndpoint endpoint, int seerrUserId, HomeContext context, CancellationToken cancellationToken);

    /// <summary>Catalog items for a discover result list; results without a media type are taken to be <paramref name="defaultType"/>.</summary>
    protected IEnumerable<(SeerrMedia Media, CatalogItemDto Item)> Map(IEnumerable<SeerrMedia>? results, string? defaultType, User user)
    {
        foreach (var media in results ?? [])
        {
            if (Mapper.ToItem(media.MediaType ?? defaultType ?? string.Empty, media, user) is { } item)
            {
                yield return (media, item);
            }
        }
    }

    private IEnumerable<HomeRowEntry> ToEntries(IEnumerable<CatalogItemDto> items, User user)
    {
        var seen = new HashSet<Guid>();
        foreach (var item in items)
        {
            if (Mapper.VisibleItem(item.JellyfinItemId, user) is { } owned)
            {
                if (seen.Add(owned.Id))
                {
                    yield return HomeRowEntry.ForItem(owned);
                }
            }
            else
            {
                yield return HomeRowEntry.ForCatalog(item);
            }
        }
    }
}

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

/// <summary>
/// The user's recent requests, newest first: declined requests skipped, one card per title. Seerr's request list has
/// no titles or art, so each title's details are fetched (cached server-wide, a few at a time); the state comes from
/// the request's media, which is fresh.
/// </summary>
public sealed class MyRequestsProvider : CatalogSectionProvider
{
    public const int MaxConcurrentDetails = 6;
    private const int Declined = 3;

    public MyRequestsProvider(CatalogRowAccess access, ISeerrClient seerr, CatalogMapper mapper, ILogger<MyRequestsProvider> logger)
        : base(access, seerr, mapper, logger)
    {
    }

    public override string Type => SectionTypes.MyRequests;

    public override string DisplayName => "My Requests";

    public override string Description => "What the viewer has requested through Seerr and how each request is going; hidden when there are none.";

    protected override async Task<IReadOnlyList<CatalogItemDto>> GetItemsAsync(SeerrEndpoint endpoint, int seerrUserId, HomeContext context, CancellationToken cancellationToken)
    {
        var requests = await Seerr.GetUserRequestsAsync(endpoint, seerrUserId, cancellationToken).ConfigureAwait(false);
        var wanted = requests
            .Where(r => r.Status != Declined && r.Media is { TmdbId: > 0 })
            .Select(r => (Request: r, MediaType: r.Type ?? r.Media!.MediaType))
            .Where(r => CatalogMediaType.IsValid(r.MediaType))
            .OrderByDescending(r => r.Request.CreatedAt ?? DateTimeOffset.MinValue)
            .DistinctBy(r => (r.MediaType, r.Request.Media!.TmdbId))
            .Take(context.ItemLimit)
            .ToList();

        using var gate = new SemaphoreSlim(MaxConcurrentDetails);
        var items = await Task.WhenAll(wanted.Select(r => ResolveAsync(endpoint, seerrUserId, r.MediaType!, r.Request.Media!, context.User, gate, cancellationToken)))
            .ConfigureAwait(false);
        return items.OfType<CatalogItemDto>().ToList();
    }

    /// <summary>The card for one requested title, or null if Seerr couldn't give its details.</summary>
    private async Task<CatalogItemDto?> ResolveAsync(
        SeerrEndpoint endpoint, int seerrUserId, string mediaType, SeerrRequestMedia media, User user, SemaphoreSlim gate, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        SeerrTitle title;
        try
        {
            title = await Seerr.GetTitleSummaryAsync(endpoint, seerrUserId, mediaType, media.TmdbId, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException)
        {
            return null;
        }
        finally
        {
            gate.Release();
        }

        // Card fields from the (cached) details; the state and Jellyfin item from the request, which is fresh.
        var card = new SeerrMedia
        {
            MediaType = mediaType,
            Id = media.TmdbId,
            Title = title.Title,
            Name = title.Name,
            ReleaseDate = title.ReleaseDate,
            FirstAirDate = title.FirstAirDate,
            Overview = title.Overview,
            PosterPath = title.PosterPath,
            BackdropPath = title.BackdropPath,
            VoteAverage = title.VoteAverage,
            GenreIds = title.GenreIds,
            MediaInfo = new SeerrMediaInfo { Status = media.Status, JellyfinMediaId = media.JellyfinMediaId },
        };
        var genres = title.Genres is { Count: > 0 } ? title.Genres.Select(g => g.Name).OfType<string>().Where(n => n.Length > 0).ToList() : null;
        return Mapper.ToItem(mediaType, card, user, genres);
    }
}
