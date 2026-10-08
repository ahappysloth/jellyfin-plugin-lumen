using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Picks hero items from the configured source; items need a backdrop, and those with a logo come first.</summary>
public sealed class HeroService : IHeroService
{
    private const int CandidateMultiplier = 4;
    private readonly ILibraryManager _libraryManager;
    private readonly ILinkedItemsReader _reader;
    private readonly ITrailerLookup _trailers;

    public HeroService(ILibraryManager libraryManager, ILinkedItemsReader reader, ITrailerLookup trailers)
    {
        _libraryManager = libraryManager;
        _reader = reader;
        _trailers = trailers;
    }

    public Task<IReadOnlyList<HeroItem>> GetHeroAsync(HomeContext context, PluginConfiguration config, CancellationToken cancellationToken)
    {
        IReadOnlyList<BaseItem> candidates = config.HeroSource switch
        {
            HeroSource.Collection => config.HeroCollectionId is { } id ? _reader.GetCollection(id, context.User)?.Items ?? [] : [],
            HeroSource.TopRatedUnplayed => Query(context, config, isPlayed: false, (ItemSortBy.CommunityRating, SortOrder.Descending)),
            _ => Query(context, config, isPlayed: null, (ItemSortBy.DateCreated, SortOrder.Descending)),
        };

        IReadOnlyList<HeroItem> hero = Rank(candidates, config.HeroCount)
            .Select(item => new HeroItem(item, _trailers.GetLocalTrailerId(item, context.User)))
            .ToList();
        return Task.FromResult(hero);
    }

    internal static IReadOnlyList<BaseItem> Rank(IEnumerable<BaseItem> candidates, int count)
    {
        var withBackdrop = candidates.Where(i => i.HasImage(ImageType.Backdrop, 0)).ToList();
        return withBackdrop.Where(i => i.HasImage(ImageType.Logo, 0))
            .Concat(withBackdrop.Where(i => !i.HasImage(ImageType.Logo, 0)))
            .Take(count)
            .ToList();
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
