using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>The home screen endpoint.</summary>
[ApiController]
[Route("Lumen")]
[Authorize]
public sealed class HomeController : ControllerBase
{
    private readonly IHomeService _home;
    private readonly IUserManager _users;

    public HomeController(IHomeService home, IUserManager users)
    {
        _home = home;
        _users = users;
    }

    [HttpGet("Home")]
    public async Task<ActionResult<HomeResponseDto>> GetHome(CancellationToken cancellationToken)
    {
        var user = User.GetJellyfinUserId() is { } id ? _users.GetUserById(id) : null;
        if (user is null)
        {
            return Unauthorized();
        }

        return await _home.GetHomeAsync(user, cancellationToken);
    }
}
