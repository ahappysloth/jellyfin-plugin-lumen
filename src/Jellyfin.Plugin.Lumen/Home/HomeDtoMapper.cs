using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Querying;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Maps domain items to the minimal DTOs the client needs.</summary>
public interface IHomeDtoMapper
{
    IReadOnlyList<BaseItemDto> MapCards(IReadOnlyList<BaseItem> items, User user);

    BaseItemDto MapHero(BaseItem item, User user);

    /// <summary>
    /// Points each card in <paramref name="cards"/> whose id is a key of <paramref name="sources"/> at that source
    /// item's first backdrop (<c>ParentBackdropItemId</c> + <c>ParentBackdropImageTags</c>). Cards whose source has no
    /// backdrop are left unchanged.
    /// </summary>
    void ApplyBackdropSources(IReadOnlyList<BaseItemDto> cards, IReadOnlyDictionary<Guid, BaseItem> sources, User user);
}

/// <summary><see cref="IHomeDtoMapper"/> backed by Jellyfin's DTO service.</summary>
public sealed class HomeDtoMapper : IHomeDtoMapper
{
    private readonly IDtoService _dtoService;

    public HomeDtoMapper(IDtoService dtoService)
    {
        _dtoService = dtoService;
    }

    public IReadOnlyList<BaseItemDto> MapCards(IReadOnlyList<BaseItem> items, User user) =>
        _dtoService.GetBaseItemDtos(items, CardOptions(), user);

    public BaseItemDto MapHero(BaseItem item, User user) => _dtoService.GetBaseItemDto(item, HeroOptions(), user);

    public void ApplyBackdropSources(IReadOnlyList<BaseItemDto> cards, IReadOnlyDictionary<Guid, BaseItem> sources, User user)
    {
        var distinct = sources.Values.DistinctBy(s => s.Id).ToList();
        if (distinct.Count == 0)
        {
            return;
        }

        var tags = _dtoService.GetBaseItemDtos(distinct, BackdropOptions(), user)
            .Where(d => d.BackdropImageTags is { Length: > 0 })
            .ToDictionary(d => d.Id, d => d.BackdropImageTags[0]);
        foreach (var card in cards)
        {
            if (sources.TryGetValue(card.Id, out var source) && tags.TryGetValue(source.Id, out var tag))
            {
                card.ParentBackdropItemId = source.Id;
                card.ParentBackdropImageTags = [tag];
            }
        }
    }

    private static DtoOptions CardOptions() => new(false)
    {
        Fields = [ItemFields.PrimaryImageAspectRatio],
        ImageTypes = [ImageType.Primary, ImageType.Backdrop, ImageType.Thumb, ImageType.Logo],
        ImageTypeLimit = 1,
        EnableImages = true,
        EnableUserData = true,
    };

    private static DtoOptions BackdropOptions() => new(false)
    {
        Fields = [],
        ImageTypes = [ImageType.Backdrop],
        ImageTypeLimit = 1,
        EnableImages = true,
        EnableUserData = false,
    };

    private static DtoOptions HeroOptions() => new(false)
    {
        Fields = [ItemFields.PrimaryImageAspectRatio, ItemFields.Overview, ItemFields.Genres],
        ImageTypes = [ImageType.Backdrop, ImageType.Logo, ImageType.Primary],
        ImageTypeLimit = 1,
        EnableImages = true,
        EnableUserData = true,
    };
}
