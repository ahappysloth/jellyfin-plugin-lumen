using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class HomeDtoMapperTests
{
    [Fact]
    public void ApplyBackdropSources_SetsParentBackdrop_FromTheSourcesFirstBackdropTag()
    {
        var user = TestData.User();
        var drama = new Genre { Id = Guid.NewGuid(), Name = "Drama" };
        var comedy = new Genre { Id = Guid.NewGuid(), Name = "Comedy" };
        var bare = new Genre { Id = Guid.NewGuid(), Name = "Bare" };
        var withArt = TestData.Movie("art");
        var noArt = TestData.Movie("none");
        var dtoService = Substitute.For<IDtoService>();
        DtoOptions? options = null;
        dtoService.GetBaseItemDtos(Arg.Any<IReadOnlyList<BaseItem>>(), Arg.Do<DtoOptions>(o => options = o), user, null, false).Returns(
        [
            new BaseItemDto { Id = withArt.Id, BackdropImageTags = ["t1", "t2"] },
            new BaseItemDto { Id = noArt.Id, BackdropImageTags = [] },
        ]);
        var cards = new[] { new BaseItemDto { Id = drama.Id }, new BaseItemDto { Id = comedy.Id }, new BaseItemDto { Id = bare.Id } };

        new HomeDtoMapper(dtoService).ApplyBackdropSources(cards, new Dictionary<Guid, BaseItem> { [drama.Id] = withArt, [comedy.Id] = noArt }, user);

        Assert.Equal(withArt.Id, cards[0].ParentBackdropItemId);
        Assert.Equal(["t1"], cards[0].ParentBackdropImageTags);
        Assert.Null(cards[1].ParentBackdropItemId);
        Assert.Null(cards[2].ParentBackdropItemId);
        Assert.Equal([ImageType.Backdrop], options!.ImageTypes);
    }
}
