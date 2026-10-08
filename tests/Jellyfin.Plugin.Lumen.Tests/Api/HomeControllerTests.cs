using System.Security.Claims;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class HomeControllerTests
{
    private readonly IHomeService _home = Substitute.For<IHomeService>();
    private readonly IUserManager _users = Substitute.For<IUserManager>();

    [Fact]
    public async Task UnknownUser_IsUnauthorized()
    {
        var result = await Create().GetHome(CancellationToken.None);

        Assert.IsType<UnauthorizedResult>(result.Result);
    }

    [Fact]
    public async Task ReturnsHomeForClaimedUser()
    {
        var user = TestData.User();
        var response = new HomeResponseDto(3, [], []);
        _users.GetUserById(user.Id).Returns(user);
        _home.GetHomeAsync(user, Arg.Any<CancellationToken>()).Returns(response);

        var result = await Create(new Claim("Jellyfin-UserId", user.Id.ToString("N"))).GetHome(CancellationToken.None);

        Assert.Same(response, result.Value);
    }

    private HomeController Create(params Claim[] claims) => new(_home, _users)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) },
        },
    };
}
