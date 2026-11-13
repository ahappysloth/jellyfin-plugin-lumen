using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using MediaBrowser.Controller;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Health;

/// <summary>
/// Runs the Health tab's server-side checks: all at once, each given at most <see cref="CheckTimeout"/>, so the page
/// loads quickly even while Seerr, Trakt or GitHub is down. The report is kept for <see cref="CacheFor"/>, because the
/// settings page asks on every open (for the tab's badge); "Run checks again" asks for a fresh one. Requests that arrive
/// while checks run share them.
/// </summary>
public sealed class HealthService
{
    /// <summary>
    /// A check's time limit: past Seerr's 5 s timeout for one call, so a Seerr that answers slowly still gets its own
    /// error message before the limit's.
    /// </summary>
    public static readonly TimeSpan CheckTimeout = TimeSpan.FromSeconds(6);

    public static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(60);

    private readonly IReadOnlyList<IHealthCheck> _checks;
    private readonly DiagnosticsStore _diagnostics;
    private readonly ILumenConfigReader _config;
    private readonly IServerApplicationHost _host;
    private readonly TimeProvider _time;
    private readonly ILogger<HealthService> _logger;
    private readonly Lock _lock = new();
    private Task<IReadOnlyList<HealthCheckResult>>? _running;
    private bool _runningFresh;
    private int _runId;
    private IReadOnlyList<HealthCheckResult>? _cached;
    private DateTimeOffset _cachedAt;

    public HealthService(
        IEnumerable<IHealthCheck> checks,
        DiagnosticsStore diagnostics,
        ILumenConfigReader config,
        IServerApplicationHost host,
        TimeProvider time,
        ILogger<HealthService> logger)
    {
        _checks = checks.ToList();
        _diagnostics = diagnostics;
        _config = config;
        _host = host;
        _time = time;
        _logger = logger;
    }

    public async Task<HealthReportDto> GetReportAsync(bool fresh, CancellationToken cancellationToken)
    {
        Task<IReadOnlyList<HealthCheckResult>> run;
        DateTimeOffset checkedAt;
        lock (_lock)
        {
            var now = _time.GetUtcNow();
            if (!fresh && _cached is not null && now - _cachedAt < CacheFor)
            {
                return Report(_cached, _cachedAt);
            }

            // A fresh run shares one already going only if that one is fresh too; a cached-allowed one may reuse anything.
            if (_running is null || (fresh && !_runningFresh))
            {
                var id = ++_runId;
                _running = Task.Run(() => RunAllAsync(fresh, id), CancellationToken.None);
                _runningFresh = fresh;
            }

            run = _running;
            checkedAt = now;
        }

        var results = await run.WaitAsync(cancellationToken).ConfigureAwait(false);
        lock (_lock)
        {
            return Report(results, _cached == results ? _cachedAt : checkedAt);
        }
    }

    private HealthReportDto Report(IReadOnlyList<HealthCheckResult> checks, DateTimeOffset at) =>
        new(
            at,
            typeof(LumenPlugin).Assembly.GetName().Version?.ToString(3) ?? "unknown",
            _host.ApplicationVersionString,
            checks,
            _diagnostics.GetAll(),
            _config.Current.QuickConnectAddress ?? string.Empty);

    private async Task<IReadOnlyList<HealthCheckResult>> RunAllAsync(bool fresh, int id)
    {
        try
        {
            var results = await Task.WhenAll(_checks.Select(c => RunOneAsync(c, fresh))).ConfigureAwait(false);
            lock (_lock)
            {
                _cached = results;
                _cachedAt = _time.GetUtcNow();
                return results;
            }
        }
        finally
        {
            lock (_lock)
            {
                // Unless a fresh run has replaced this one meanwhile.
                if (_runId == id)
                {
                    _running = null;
                }
            }
        }
    }

    private async Task<HealthCheckResult> RunOneAsync(IHealthCheck check, bool fresh)
    {
        using var timeout = new CancellationTokenSource(CheckTimeout, _time);
        try
        {
            // WaitAsync as well as the token: a check stuck in something that ignores cancellation still lets the page go.
            return await Task.Run(() => check.RunAsync(fresh, timeout.Token), timeout.Token).WaitAsync(CheckTimeout, _time).ConfigureAwait(false);
        }
        catch (Exception e) when (e is TimeoutException or OperationCanceledException)
        {
            return check.Result(
                HealthStatus.Warning,
                $"This check didn't finish within {CheckTimeout.TotalSeconds:0} seconds. What it asks may be slow or down; run the checks again in a moment.");
        }
#pragma warning disable CA1031 // One failing check must not take the others (or the page) with it.
        catch (Exception e)
#pragma warning restore CA1031
        {
            _logger.LogWarning(e, "Lumen's health check {Check} failed", check.Id);
            return check.Result(HealthStatus.Warning, "This check couldn't run. Jellyfin's log has the details.");
        }
    }
}
