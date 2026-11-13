using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>Notifications: the job that sends them is running, and Lumen's Web Push keys are made.</summary>
public sealed class PushServiceCheck : IHealthCheck
{
    private readonly ILumenConfigReader _config;
    private readonly ReadyPushSignal _signal;

    public PushServiceCheck(ILumenConfigReader config, ReadyPushSignal signal)
    {
        _config = config;
        _signal = signal;
    }

    public string Id => "notifications.service";

    public string Group => HealthGroup.Notifications;

    public string Title => "Notification job";

    public Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        var config = _config.Current;
        if (PushRows.Off(config) is { } off)
        {
            return Task.FromResult(this.Result(HealthStatus.NotApplicable, off, PushRows.OpenRequests));
        }

        if (!_signal.Running)
        {
            return Task.FromResult(this.Result(
                HealthStatus.Problem,
                "The job that sends notifications isn't running, so none are sent (users see the in-app pop-up instead). Restart Jellyfin; if it stays off, Jellyfin's log says why."));
        }

        // Only whether the public key exists: the keys themselves are never read here.
        var message = string.IsNullOrEmpty(config.VapidPublicKey)
            ? "The job that sends notifications is running. Lumen makes its notification keys the first time a device asks for them."
            : "The job that sends notifications is running, and Lumen's notification keys are made.";
        return Task.FromResult(this.Result(HealthStatus.Ok, message));
    }
}
