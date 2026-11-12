using Jellyfin.Plugin.Lumen.Storage;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>The Storage card on Lumen's settings page (admins only): where the space goes. Read-only.</summary>
[ApiController]
[Route("Lumen/Admin/Storage")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class StorageController : ControllerBase
{
    private readonly StorageReportService _storage;

    public StorageController(StorageReportService storage)
    {
        _storage = storage;
    }

    /// <summary>The cached report; starts a scan when there is none or it's over 10 minutes old.</summary>
    [HttpGet]
    public async Task<ActionResult<StorageStatusDto>> Get(CancellationToken cancellationToken) =>
        await _storage.GetAsync(false, cancellationToken).ConfigureAwait(false);

    /// <summary>Scans again now (unless a scan is already running).</summary>
    [HttpPost("Refresh")]
    public async Task<ActionResult<StorageStatusDto>> Refresh(CancellationToken cancellationToken) =>
        await _storage.GetAsync(true, cancellationToken).ConfigureAwait(false);
}
