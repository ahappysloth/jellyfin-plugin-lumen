using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Push;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>Notifications: how the last one sent since Jellyfin started went.</summary>
public sealed class PushDeliveryCheck : IHealthCheck
{
    private readonly ILumenConfigReader _config;
    private readonly IPushSender _sender;
    private readonly TimeProvider _time;

    public PushDeliveryCheck(ILumenConfigReader config, IPushSender sender, TimeProvider time)
    {
        _config = config;
        _sender = sender;
        _time = time;
    }

    public string Id => "notifications.lastSend";

    public string Group => HealthGroup.Notifications;

    public string Title => "Last notification";

    public Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        if (PushRows.Off(_config.Current) is { } off)
        {
            return Task.FromResult(this.Result(HealthStatus.NotApplicable, off));
        }

        if (_sender.Last is not { } last)
        {
            return Task.FromResult(this.Result(HealthStatus.NotApplicable, "Nothing has been sent since Jellyfin started."));
        }

        var what = last.Kind == "test" ? "A test notification" : "A \"ready to watch\" notification";
        var when = HealthText.Ago(last.At, _time.GetUtcNow());
        var status = last.Status is { } code ? $" (HTTP {code})" : string.Empty;
        if (last.Sent > 0)
        {
            var missed = last.Gone + last.Rejected + last.Failed;
            return Task.FromResult(this.Result(
                HealthStatus.Ok,
                $"{what} reached {HealthText.Plural(last.Sent, "device")} {when}." + (missed > 0 ? $" {HealthText.Plural(missed, "device")} couldn't be reached." : string.Empty)));
        }

        // A device that had turned notifications off is removed, and that's all: nothing failed.
        if (last.Rejected == 0 && last.Failed == 0)
        {
            return Task.FromResult(this.Result(HealthStatus.Ok, $"{what} {when} found the device had turned notifications off, so Lumen removed it."));
        }

        var why = last.Rejected > 0
            ? $"the push service refused it{status}. If every device is refused, the notification keys may have changed: users turn notifications off and on again"
            : $"the push service couldn't be reached{status}. Lumen tries a few more times, then leaves it to the in-app pop-up";
        return Task.FromResult(this.Result(HealthStatus.Warning, $"{what} {when} wasn't delivered: {why}.", PushRows.OpenRequests));
    }
}
