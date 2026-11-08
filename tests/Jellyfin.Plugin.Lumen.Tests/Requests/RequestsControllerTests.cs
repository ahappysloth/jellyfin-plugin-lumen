using System.Security.Claims;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public class RequestsControllerTests
{
    private readonly ISeerrUserMap _users = Substitute.For<ISeerrUserMap>();
    private readonly ITmdbImageCache _images = Substitute.For<ITmdbImageCache>();
    private readonly Guid _user = Guid.NewGuid();

    [Fact]
    public async Task Status_RequiresAJellyfinUser()
    {
        Assert.IsType<UnauthorizedResult>((await Create(signedIn: false).GetStatus(CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Status_ReportsTheUsersAccess_WithoutTheirSeerrId()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, false, 9));

        var status = (await Create().GetStatus(CancellationToken.None)).Value;

        Assert.Equal(new RequestStatusDto(true, true, false), status);
    }

    [Fact]
    public async Task Image_RejectsDisallowedPaths_BeforeAnyLookup()
    {
        Assert.IsType<BadRequestResult>(await Create().GetImage("w780", "..%2Fx.jpg", CancellationToken.None));
        await _users.DidNotReceiveWithAnyArgs().GetAccessAsync(default, default);
    }

    [Fact]
    public async Task Image_IsHiddenFromUsersWithoutCatalogAccess()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        Assert.IsType<NotFoundResult>(await Create().GetImage("w780", "abc.jpg", CancellationToken.None));
        await _images.DidNotReceiveWithAnyArgs().GetAsync(default!, default!, default);
    }

    [Fact]
    public async Task Image_ServesTheCachedFile_WithLongCaching()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, false, false, 1));
        _images.GetAsync("w780", "abc.jpg", Arg.Any<CancellationToken>()).Returns(new CachedImage("/tmp/abc.jpg", "image/jpeg"));
        var controller = Create();

        var file = Assert.IsType<PhysicalFileResult>(await controller.GetImage("w780", "abc.jpg", CancellationToken.None));

        Assert.Equal("/tmp/abc.jpg", file.FileName);
        Assert.Contains("max-age=604800", controller.Response.Headers.CacheControl.ToString(), StringComparison.Ordinal);
    }

    private RequestsController Create(bool signedIn = true) => new(_users, _images)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(signedIn ? [new Claim("Jellyfin-UserId", _user.ToString("N"))] : [], "test")),
            },
        },
    };
}
