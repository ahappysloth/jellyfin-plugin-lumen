using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Storage;

/// <summary>
/// The storage report, computed in the background and kept for <see cref="CacheFor"/>, so opening the settings page
/// doesn't rescan the database each time. Asking for it starts a scan when there is no report or it has gone stale, then
/// answers within <see cref="AnswerWithin"/>: the finished report, or "computing" (with the previous report, if any)
/// for the page to ask again. Only one scan runs at a time; it stops when Jellyfin shuts down.
/// </summary>
public sealed class StorageReportService : IDisposable
{
    public static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(10);

    public static readonly TimeSpan AnswerWithin = TimeSpan.FromSeconds(2);

    /// <summary>After a failed scan, how long a plain request waits before trying again (Refresh always does).</summary>
    public static readonly TimeSpan RetryFailedAfter = TimeSpan.FromMinutes(1);

    private readonly IStorageScanner _scanner;
    private readonly TimeProvider _time;
    private readonly ILogger<StorageReportService> _logger;
    private readonly CancellationTokenSource _stopping = new();
    private readonly Lock _lock = new();
    private StorageReportDto? _report;
    private Task? _running;
    private DateTimeOffset? _failedAt;
    private bool _disposed;

    public StorageReportService(IStorageScanner scanner, TimeProvider time, ILogger<StorageReportService> logger)
    {
        _scanner = scanner;
        _time = time;
        _logger = logger;
    }

    /// <summary>The report, or where its scan has got to.</summary>
    /// <param name="refresh">Scan again even if the report is fresh (unless a scan is already running).</param>
    /// <param name="cancellationToken">Stops waiting for the scan; the scan itself carries on for the next request.</param>
    public async Task<StorageStatusDto> GetAsync(bool refresh, CancellationToken cancellationToken)
    {
        Task? running;
        lock (_lock)
        {
            if (_running is null && !_disposed && (refresh || ShouldScan()))
            {
                _running = ScanAsync();
            }

            running = _running;
        }

        if (running is not null)
        {
            await Task.WhenAny(running, Task.Delay(AnswerWithin, _time, cancellationToken)).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
        }

        lock (_lock)
        {
            if (_running is not null)
            {
                return new StorageStatusDto(StorageState.Computing, _report, null);
            }

            return _failedAt is not null
                ? new StorageStatusDto(StorageState.Failed, _report, "Couldn't read the libraries. Try again in a moment.")
                : new StorageStatusDto(StorageState.Ready, _report, null);
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
        }

        _stopping.Cancel();
        _stopping.Dispose();
    }

    private bool ShouldScan()
    {
        var now = _time.GetUtcNow();
        if (_failedAt is { } failed)
        {
            return now - failed >= RetryFailedAfter;
        }

        return _report is null || now - _report.ComputedAt >= CacheFor;
    }

    private async Task ScanAsync()
    {
        // Called under the lock (so not yet disposed): everything after the yield runs on the thread pool, once GetAsync
        // has recorded the task.
        var token = _stopping.Token;
        await Task.Yield();
        try
        {
            var report = await Task.Run(() => _scanner.Scan(token), token).ConfigureAwait(false);
            lock (_lock)
            {
                _report = report;
                _failedAt = null;
            }
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            // Jellyfin is shutting down.
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lumen couldn't compute the storage report");
            lock (_lock)
            {
                _failedAt = _time.GetUtcNow();
            }
        }
        finally
        {
            lock (_lock)
            {
                _running = null;
            }
        }
    }
}
