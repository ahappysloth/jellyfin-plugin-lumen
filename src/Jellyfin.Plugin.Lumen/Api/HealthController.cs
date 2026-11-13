using Jellyfin.Plugin.Lumen.Health;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>The settings page's Health tab: the server-side checks (admins only).</summary>
[ApiController]
[Route("Lumen/Admin/Health")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class HealthController : ControllerBase
{
    private readonly HealthService _health;

    public HealthController(HealthService health)
    {
        _health = health;
    }

    /// <summary>Runs the checks, or returns the last minute's; <paramref name="refresh"/> runs them all again.</summary>
    [HttpGet]
    public async Task<ActionResult<HealthReportDto>> Get([FromQuery] bool refresh, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        return await _health.GetReportAsync(refresh, cancellationToken).ConfigureAwait(false);
    }
}
