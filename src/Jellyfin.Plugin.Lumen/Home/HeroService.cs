using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>
/// Picks hero items from the configured source; items need a backdrop, and those with a logo come first. Each slide gets
/// its local trailer, or failing that (with "Use online trailers" on) its trailer on IMDb, else its trailer's YouTube id.
/// </summary>
public sealed class HeroService : IHeroService
{
    /// <summary>
    /// How long the slides' online trailer lookups (IMDb, then YouTube) may take together: well inside the home's own
    /// limit for the hero (<see cref="HomeService.ProviderTimeout"/>), which would otherwise drop every slide for a slow
    /// IMDb or Seerr. A lookup still running by then goes on by itself and is cached, so the slide has its trailer on the
    /// next build (a minute later).
    /// </summary>
    public static readonly TimeSpan OnlineBudget = TimeSpan.FromSeconds(1.5);

    private const int CandidateMultiplier = 4;
    private readonly ILibraryManager _libraryManager;
    private readonly ILinkedItemsReader _reader;
    private readonly ITrailerLookup _trailers;
    private readonly IOnlineTrailers _online;
    private readonly TimeProvider _time;

    public HeroService(ILibraryManager libraryManager, ILinkedItemsReader reader, ITrailerLookup trailers, IOnlineTrailers online, TimeProvider time)
    {
        _libraryManager = libraryManager;
        _reader = reader;
        _trailers = trailers;
        _online = online;
        _time = time;
    }

    public async Task<IReadOnlyList<HeroItem>> GetHeroAsync(HomeContext context, PluginConfiguration config, CancellationToken cancellationToken)
    {
        IReadOnlyList<BaseItem> candidates = config.HeroSource switch
        {
            HeroSource.Collection => config.HeroCollectionId is { } id ? _reader.GetCollection(id, context.User)?.Items ?? [] : [],
            HeroSource.TopRatedUnplayed => Query(context, config, isPlayed: false, (ItemSortBy.CommunityRating, SortOrder.Descending)),
            _ => Query(context, config, isPlayed: null, (ItemSortBy.DateCreated, SortOrder.Descending)),
        };

        cancellationToken.ThrowIfCancellationRequested();
        var hero = Rank(candidates, config.HeroCount)
            .Select(item => new HeroItem(item, _trailers.GetLocalTrailerId(item, context.User)))
            .ToList();
        if (!config.TrailerPreview || !config.YouTubeTrailers)
        {
            return hero;
        }

        // A local trailer always wins. The lookups aren't cancelled with this build: see OnlineBudget.
        var lookups = hero.Select(h => h.TrailerItemId is null ? LookUpAsync(h.Item, context.User) : Task.FromResult(OnlineTrailer.None)).ToList();
        try
        {
            await Task.WhenAll(lookups).WaitAsync(OnlineBudget, _time, cancellationToken).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            // Whatever is known by now.
        }

        return hero.Select((h, i) => lookups[i].IsCompletedSuccessfully && lookups[i].Result is { } online
            ? h with { TrailerImdbUrl = online.ImdbUrl, TrailerImdbUrlHd = online.ImdbUrl is null ? null : online.ImdbUrlHd, TrailerYouTubeId = online.ImdbUrl is null ? online.YouTubeId : null }
            : h).ToList();
    }

    internal static IReadOnlyList<BaseItem> Rank(IEnumerable<BaseItem> candidates, int count)
    {
        var withBackdrop = candidates.Where(i => i.HasImage(ImageType.Backdrop, 0)).ToList();
        return withBackdrop.Where(i => i.HasImage(ImageType.Logo, 0))
            .Concat(withBackdrop.Where(i => !i.HasImage(ImageType.Logo, 0)))
            .Take(count)
            .ToList();
    }

    /// <summary>One slide's lookup; a failure (there shouldn't be one) costs that slide its trailer, not the hero.</summary>
    private async Task<OnlineTrailer> LookUpAsync(BaseItem item, User user)
    {
        try
        {
            return await _online.GetAsync(item, user, CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            return OnlineTrailer.None;
        }
    }

    private IReadOnlyList<BaseItem> Query(HomeContext context, PluginConfiguration config, bool? isPlayed, (ItemSortBy Sort, SortOrder Direction) order) =>
        _libraryManager.GetItemList(new InternalItemsQuery(context.User)
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Series],
            Recursive = true,
            IsVirtualItem = false,
            IsPlayed = isPlayed,
            ImageTypes = [ImageType.Backdrop],
            OrderBy = [order],
            Limit = config.HeroCount * CandidateMultiplier,
            DtoOptions = QueryOptions.Full(),
        });
}
