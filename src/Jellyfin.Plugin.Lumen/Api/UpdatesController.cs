using Jellyfin.Plugin.Lumen.Updates;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>"Check for updates" on Lumen's settings page and Jellyfin's Plugins page (admins only).</summary>
[ApiController]
[Route("Lumen/Admin/Updates")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class UpdatesController : ControllerBase
{
    private readonly UpdateChecker _checker;

    public UpdatesController(UpdateChecker checker)
    {
        _checker = checker;
    }

    [HttpGet]
    public async Task<ActionResult<UpdateStatusDto>> Check(CancellationToken cancellationToken) =>
        await _checker.CheckAsync(cancellationToken).ConfigureAwait(false);

    [HttpPost("Install")]
    public async Task<ActionResult<UpdateStatusDto>> Install([FromBody] InstallUpdateDto body, CancellationToken cancellationToken)
    {
        var status = await _checker.InstallAsync(body.Version, cancellationToken).ConfigureAwait(false);
        return status is null ? NotFound(new ValidationErrorsDto([$"Lumen {body.Version} isn't available to install."])) : status;
    }
}

/// <summary>The version to install (as returned by a check).</summary>
public sealed record InstallUpdateDto(string Version);
