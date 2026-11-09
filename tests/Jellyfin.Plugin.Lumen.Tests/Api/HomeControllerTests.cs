using System.Security.Claims;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class HomeControllerTests
{
    private readonly IHomeService _home = Substitute.For<IHomeService>();
    private readonly IUserManager _users = Substitute.For<IUserManager>();
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();

    public HomeControllerTests() => _config.Current.Returns(new PluginConfiguration());

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
        var response = new HomeResponseDto(3, [], [], new Dictionary<string, string>());
        _users.GetUserById(user.Id).Returns(user);
        _home.GetHomeAsync(user, Arg.Any<CancellationToken>()).Returns(response);

        var result = await Create(new Claim("Jellyfin-UserId", user.Id.ToString("N"))).GetHome(CancellationToken.None);

        Assert.Same(response, result.Value);
    }

    [Fact]
    public async Task IsNotFound_WhileLumenIsSwitchedOff()
    {
        var user = TestData.User();
        _users.GetUserById(user.Id).Returns(user);
        _config.Current.Returns(new PluginConfiguration { Enabled = false });

        var result = await Create(new Claim("Jellyfin-UserId", user.Id.ToString("N"))).GetHome(CancellationToken.None);

        Assert.IsType<NotFoundResult>(result.Result);
        await _home.DidNotReceiveWithAnyArgs().GetHomeAsync(default!, default);
    }

    private HomeController Create(params Claim[] claims) => new(_home, _users, _config, NullLogger<HomeController>.Instance)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) },
        },
    };
}
