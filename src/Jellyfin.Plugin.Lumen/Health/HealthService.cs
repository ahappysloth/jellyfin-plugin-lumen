using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using MediaBrowser.Controller;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Health;

/// <summary>
/// Runs the Health tab's server-side checks: all at once, each given at most its <see cref="IHealthCheck.TimeLimit"/>, so
/// the page loads quickly even while Seerr, Trakt or GitHub is down. The report is kept for <see cref="CacheFor"/>, because
/// the settings page asks on every open (for the tab's badge); "Run checks again" asks for a fresh one. A saved
/// configuration (any save bumps its ConfigVersion) or <see cref="Invalidate"/> (after an update is installed) makes the
/// kept report stale at once, so fixing a setting shows on the next ask. Requests that arrive while checks run share them.
/// </summary>
public sealed class HealthService
{
    /// <summary>A check's time limit unless it sets its own (<see cref="IHealthCheck.TimeLimit"/>).</summary>
    public static readonly TimeSpan CheckTimeout = TimeSpan.FromSeconds(6);

    public static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(60);

    private readonly IReadOnlyList<IHealthCheck> _checks;
    private readonly DiagnosticsStore _diagnostics;
    private readonly ILumenConfigReader _config;
    private readonly IServerApplicationHost _host;
    private readonly TimeProvider _time;
    private readonly ILogger<HealthService> _logger;
    private readonly Lock _lock = new();
    private Run? _running;
    private int _runId;

    /// <summary>Goes up on <see cref="Invalidate"/>: a run or report from before it is stale.</summary>
    private int _epoch;
    private Done? _cached;

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

    /// <summary>Drops the kept report (and stops sharing a run already going), so the next ask runs the checks.</summary>
    public void Invalidate()
    {
        lock (_lock)
        {
            _epoch++;
            _cached = null;
        }
    }

    public async Task<HealthReportDto> GetReportAsync(bool fresh, CancellationToken cancellationToken)
    {
        // What the checks read: a report from an older configuration is about settings that have changed since.
        var configVersion = _config.Current.ConfigVersion;
        Task<Done> task;
        lock (_lock)
        {
            var stamp = (configVersion, _epoch);
            var now = _time.GetUtcNow();
            if (!fresh && _cached is { } cached && cached.Stamp == stamp && now - cached.At < CacheFor)
            {
                return Report(cached);
            }

            // A fresh run shares one already going only if that one is fresh too; a cached-allowed one may reuse any run
            // of the same configuration.
            if (_running is not { } running || running.Stamp != stamp || (fresh && !running.Fresh))
            {
                var id = ++_runId;
                running = new Run(id, fresh, stamp, Task.Run(() => RunAllAsync(fresh, id, stamp), CancellationToken.None));
                _running = running;
            }

            task = running.Task;
        }

        return Report(await task.WaitAsync(cancellationToken).ConfigureAwait(false));
    }

    private HealthReportDto Report(Done done) =>
        new(
            done.At,
            typeof(LumenPlugin).Assembly.GetName().Version?.ToString(3) ?? "unknown",
            _host.ApplicationVersionString,
            done.Results,
            _diagnostics.GetAll(),
            _config.Current.QuickConnectAddress ?? string.Empty);

    private async Task<Done> RunAllAsync(bool fresh, int id, (int ConfigVersion, int Epoch) stamp)
    {
        try
        {
            var results = await Task.WhenAll(_checks.Select(c => RunOneAsync(c, fresh))).ConfigureAwait(false);
            var done = new Done(id, stamp, results, _time.GetUtcNow());
            lock (_lock)
            {
                // Kept only if no later run has finished first: a slow superseded run (a cached-allowed one that a fresh
                // run or a save replaced) must not put its older results back over newer ones.
                if (_cached is null || _cached.Id < id)
                {
                    _cached = done;
                }
            }

            return done;
        }
        finally
        {
            lock (_lock)
            {
                if (_running?.Id == id)
                {
                    _running = null;
                }
            }
        }
    }

    private async Task<HealthCheckResult> RunOneAsync(IHealthCheck check, bool fresh)
    {
        var limit = check.TimeLimit;
        using var timeout = new CancellationTokenSource(limit, _time);
        try
        {
            // WaitAsync as well as the token: a check stuck in something that ignores cancellation still lets the page go.
            return await Task.Run(() => check.RunAsync(fresh, timeout.Token), timeout.Token).WaitAsync(limit, _time).ConfigureAwait(false);
        }
        catch (Exception e) when (e is TimeoutException or OperationCanceledException)
        {
            return check.Result(
                HealthStatus.Warning,
                $"This check didn't finish within {limit.TotalSeconds:0} seconds. What it asks may be slow or down; run the checks again in a moment.");
        }
#pragma warning disable CA1031 // One failing check must not take the others (or the page) with it.
        catch (Exception e)
#pragma warning restore CA1031
        {
            _logger.LogWarning(e, "Lumen's health check {Check} failed", check.Id);
            return check.Result(HealthStatus.Warning, "This check couldn't run. Jellyfin's log has the details.");
        }
    }

    /// <summary>A run going: shared by the asks that arrive meanwhile with the same stamp.</summary>
    private sealed record Run(int Id, bool Fresh, (int ConfigVersion, int Epoch) Stamp, Task<Done> Task);

    /// <summary>A finished run: its results, when they finished, and what they were checked against.</summary>
    private sealed record Done(int Id, (int ConfigVersion, int Epoch) Stamp, IReadOnlyList<HealthCheckResult> Results, DateTimeOffset At);
}
