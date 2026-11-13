using Jellyfin.Plugin.Lumen.Updates;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>
/// Server: is a newer Lumen out? The Updates card's check, kept for an hour unless the admin asks again (a failed one only
/// for a few minutes, and none past an install from the Updates card).
/// </summary>
public sealed class LumenUpdateCheck : IHealthCheck
{
    /// <summary>Each check reads GitHub: once an hour is plenty for a badge, and "Run checks again" asks anew.</summary>
    public static readonly TimeSpan KeepFor = TimeSpan.FromHours(1);

    /// <summary>"GitHub didn't answer" is usually brief: asked again after this, not after an hour.</summary>
    public static readonly TimeSpan KeepFailureFor = TimeSpan.FromMinutes(5);

    private static readonly HealthFix OpenUpdates = new("Open Updates", "setting", "updates");

    private readonly Func<CancellationToken, Task<UpdateStatusDto>> _check;
    private readonly Func<int> _installs;
    private readonly TimeProvider _time;
    private readonly Lock _lock = new();
    private (UpdateStatusDto Status, DateTimeOffset At, int Installs)? _last;

    public LumenUpdateCheck(UpdateChecker checker, TimeProvider time)
        : this(checker.CheckAsync, () => checker.Installs, time)
    {
    }

    /// <param name="check">Checks for an update.</param>
    /// <param name="installs">Counts the updates installed so far (<see cref="UpdateChecker.Installs"/>).</param>
    /// <param name="time">The clock.</param>
    internal LumenUpdateCheck(Func<CancellationToken, Task<UpdateStatusDto>> check, Func<int> installs, TimeProvider time)
    {
        _check = check;
        _installs = installs;
        _time = time;
    }

    public string Id => "server.update";

    public string Group => HealthGroup.Server;

    public string Title => "Lumen updates";

    public async Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        UpdateStatusDto? status = null;
        var installs = _installs();
        lock (_lock)
        {
            if (!fresh && _last is { } last && last.Installs == installs && _time.GetUtcNow() - last.At < (Failed(last.Status) ? KeepFailureFor : KeepFor))
            {
                status = last.Status;
            }
        }

        if (status is null)
        {
            status = await _check(cancellationToken).ConfigureAwait(false);
            lock (_lock)
            {
                _last = (status, _time.GetUtcNow(), installs);
            }
        }

        if (status.RestartPending)
        {
            return this.Result(HealthStatus.Warning, $"Lumen {status.Latest} is installed and starts when Jellyfin restarts.", OpenUpdates);
        }

        if (status.UpdateAvailable)
        {
            return this.Result(HealthStatus.Warning, $"Lumen {status.Latest} is available. This server has {status.Installed}.", OpenUpdates);
        }

        if (Failed(status))
        {
            return this.Result(HealthStatus.NotApplicable, $"Couldn't check for updates: GitHub didn't answer. This server has Lumen {status.Installed}.");
        }

        return this.Result(HealthStatus.Ok, $"Lumen {status.Installed} is the latest version.");
    }

    private static bool Failed(UpdateStatusDto status) => !status.ManifestReachable && !status.ListedByJellyfin;
}
