using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>
/// Notifications: Seerr's webhook (optional) calls Lumen with its secret and "Request Available", so a notification goes
/// out the moment something is available instead of at Lumen's next look (every 2 minutes). Read from Seerr's own
/// settings; the header it sends is only compared with Lumen's secret.
/// </summary>
public sealed class SeerrWebhookCheck : IHealthCheck
{
    private readonly ILumenConfigReader _config;
    private readonly ISeerrClient _seerr;

    public SeerrWebhookCheck(ILumenConfigReader config, ISeerrClient seerr)
    {
        _config = config;
        _seerr = seerr;
    }

    public string Id => "notifications.webhook";

    public string Group => HealthGroup.Notifications;

    public string Title => "Seerr's webhook (optional)";

    public async Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        var config = _config.Current;
        if (PushRows.Off(config) is { } off)
        {
            return this.Result(HealthStatus.NotApplicable, off);
        }

        var endpoint = SeerrEndpoint.From(config)!;

        SeerrWebhook webhook;
        try
        {
            webhook = await _seerr.GetWebhookAsync(endpoint, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException)
        {
            // The Seerr connection row says why.
            return this.Result(HealthStatus.NotApplicable, "Couldn't read Seerr's webhook settings.");
        }

        const string Without = "Lumen asks Seerr every 2 minutes instead; with the webhook, a notification goes out the moment something is available.";
        var toLumen = webhook.Url is { } url && Uri.TryCreate(url.Trim(), UriKind.Absolute, out var address)
            && address.AbsolutePath.TrimEnd('/').EndsWith("/" + PushAdminController.WebhookPath, StringComparison.OrdinalIgnoreCase);
        if (!webhook.Enabled || !toLumen)
        {
            var state = !webhook.Enabled ? "Seerr's webhook is off." : "Seerr's webhook goes somewhere other than Lumen.";
            return this.Result(HealthStatus.NotApplicable, $"{state} {Without} Its settings are under Requests → Notifications.", PushRows.OpenRequests);
        }

        if (!PushController.IsWebhookSecret(webhook.Authorization, config.PushWebhookSecret))
        {
            return this.Result(
                HealthStatus.Problem,
                "Seerr's webhook calls Lumen with a different secret, so Lumen turns its calls away. Copy the Authorization Header again from Requests → Notifications into Seerr.",
                PushRows.OpenRequests);
        }

        if (!webhook.SendsAvailable)
        {
            return this.Result(
                HealthStatus.Warning,
                $"Seerr's webhook calls Lumen, but \"Request Available\" isn't ticked under its Notification Types, so it never says something is ready. {Without}",
                PushRows.OpenRequests);
        }

        return this.Result(HealthStatus.Ok, "Seerr's webhook calls Lumen with its secret when a request is available, so notifications go out at once.");
    }
}
