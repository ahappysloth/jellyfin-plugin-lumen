using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>The home screen endpoint. Answers 404 while Lumen is switched off (the client then shows the stock home).</summary>
[ApiController]
[Route("Lumen")]
[Authorize]
public sealed class HomeController : ControllerBase
{
    private readonly IHomeService _home;
    private readonly IUserManager _users;
    private readonly ILumenConfigReader _config;
    private readonly ILogger<HomeController> _logger;

    public HomeController(IHomeService home, IUserManager users, ILumenConfigReader config, ILogger<HomeController> logger)
    {
        _home = home;
        _users = users;
        _config = config;
        _logger = logger;
    }

    [HttpGet("Home")]
    [CompressOverHttps]
    public async Task<ActionResult<HomeResponseDto>> GetHome(CancellationToken cancellationToken)
    {
        var user = User.GetJellyfinUserId(_logger) is { } id ? _users.GetUserById(id) : null;
        if (user is null)
        {
            return Unauthorized();
        }

        if (!_config.Current.Enabled)
        {
            return NotFound();
        }

        return await _home.GetHomeAsync(user, cancellationToken);
    }
}
