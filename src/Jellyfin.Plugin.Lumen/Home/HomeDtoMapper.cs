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

    private static DtoOptions CardOptions() => new(false)
    {
        Fields = [ItemFields.PrimaryImageAspectRatio],
        ImageTypes = [ImageType.Primary, ImageType.Backdrop, ImageType.Thumb, ImageType.Logo],
        ImageTypeLimit = 1,
        EnableImages = true,
        EnableUserData = true,
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
