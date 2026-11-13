using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Push;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>Notifications: how many devices have them on.</summary>
public sealed class PushDevicesCheck : IHealthCheck
{
    private readonly ILumenConfigReader _config;
    private readonly IPushSubscriptionStore _subscriptions;

    public PushDevicesCheck(ILumenConfigReader config, IPushSubscriptionStore subscriptions)
    {
        _config = config;
        _subscriptions = subscriptions;
    }

    public string Id => "notifications.devices";

    public string Group => HealthGroup.Notifications;

    public string Title => "Devices with notifications on";

    public Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        if (PushRows.Off(_config.Current) is { } off)
        {
            return Task.FromResult(this.Result(HealthStatus.NotApplicable, off));
        }

        var (devices, users) = _subscriptions.Count();
        return Task.FromResult(devices == 0
            ? this.Result(
                HealthStatus.NotApplicable,
                "No device has notifications on yet. Each user turns them on per device, in My requests or their profile page; on an iPhone or iPad, in the Home Screen app.")
            : this.Result(HealthStatus.Ok, $"{HealthText.Plural(devices, "device")} of {HealthText.Plural(users, "user")} {(devices == 1 ? "has" : "have")} notifications on."));
    }
}
