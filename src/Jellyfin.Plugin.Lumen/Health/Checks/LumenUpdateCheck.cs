using Jellyfin.Plugin.Lumen.Updates;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>Server: is a newer Lumen out? The Updates card's check, kept for an hour unless the admin asks again.</summary>
public sealed class LumenUpdateCheck : IHealthCheck
{
    /// <summary>Each check reads GitHub: once an hour is plenty for a badge, and "Run checks again" asks anew.</summary>
    public static readonly TimeSpan KeepFor = TimeSpan.FromHours(1);

    private static readonly HealthFix OpenUpdates = new("Open Updates", "setting", "updates");

    private readonly Func<CancellationToken, Task<UpdateStatusDto>> _check;
    private readonly TimeProvider _time;
    private readonly Lock _lock = new();
    private (UpdateStatusDto Status, DateTimeOffset At)? _last;

    public LumenUpdateCheck(UpdateChecker checker, TimeProvider time)
        : this(checker.CheckAsync, time)
    {
    }

    internal LumenUpdateCheck(Func<CancellationToken, Task<UpdateStatusDto>> check, TimeProvider time)
    {
        _check = check;
        _time = time;
    }

    public string Id => "server.update";

    public string Group => HealthGroup.Server;

    public string Title => "Lumen updates";

    public async Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        UpdateStatusDto? status = null;
        lock (_lock)
        {
            if (!fresh && _last is { } last && _time.GetUtcNow() - last.At < KeepFor)
            {
                status = last.Status;
            }
        }

        if (status is null)
        {
            status = await _check(cancellationToken).ConfigureAwait(false);
            lock (_lock)
            {
                _last = (status, _time.GetUtcNow());
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

        if (!status.ManifestReachable && !status.ListedByJellyfin)
        {
            return this.Result(HealthStatus.NotApplicable, $"Couldn't check for updates: GitHub didn't answer. This server has Lumen {status.Installed}.");
        }

        return this.Result(HealthStatus.Ok, $"Lumen {status.Installed} is the latest version.");
    }
}
