using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Health;
using Jellyfin.Plugin.Lumen.Health.Checks;
using Jellyfin.Plugin.Lumen.Push;
using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Health;

public class NotificationsChecksTests
{
    private const string Secret = "lumen-webhook-secret";
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly IPushSubscriptionStore _subscriptions = Substitute.For<IPushSubscriptionStore>();
    private readonly IPushSender _sender = Substitute.For<IPushSender>();
    private readonly FakeTimeProvider _time = new(DateTimeOffset.Parse("2026-11-12T12:00:00Z", System.Globalization.CultureInfo.InvariantCulture));
    private readonly ReadyPushSignal _signal;

    public NotificationsChecksTests()
    {
        _signal = new ReadyPushSignal(_subscriptions) { Running = true };
        _config.Current.Returns(Config());
    }

    [Fact]
    public async Task EveryRow_WithRequestsOff_IsNotApplicable_AndAsksSeerrNothing()
    {
        _config.Current.Returns(Config(requests: false));

        foreach (var check in Checks())
        {
            var result = await check.RunAsync(false, default);
            Assert.Equal(HealthStatus.NotApplicable, result.Status);
            Assert.Equal("Notifications come with requests, which are off.", result.Message);
        }

        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Fact]
    public async Task Service_JobNotRunning_IsAProblem_AndNeverReadsTheKeys()
    {
        Assert.Equal(HealthStatus.Ok, (await Service().RunAsync(false, default)).Status);

        _signal.Running = false;
        var result = await Service().RunAsync(false, default);

        Assert.Equal(HealthStatus.Problem, result.Status);
        Assert.Contains("Restart Jellyfin", result.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("private", result.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Devices_CountsThem()
    {
        _subscriptions.Count().Returns((0, 0));
        Assert.Equal(HealthStatus.NotApplicable, (await Devices().RunAsync(false, default)).Status);

        _subscriptions.Count().Returns((3, 2));
        Assert.Equal("3 devices of 2 users have notifications on.", (await Devices().RunAsync(false, default)).Message);
    }

    [Fact]
    public async Task LastSend_SaysHowItWent()
    {
        Assert.Equal("Nothing has been sent since Jellyfin started.", (await Delivery().RunAsync(false, default)).Message);

        _sender.Last.Returns(new PushSendReport(_time.GetUtcNow().AddMinutes(-5), "ready", 2, 0, 0, 1, null));
        var sent = await Delivery().RunAsync(false, default);
        Assert.Equal(HealthStatus.Ok, sent.Status);
        Assert.Equal("A \"ready to watch\" notification reached 2 devices 5 minutes ago. 1 device couldn't be reached.", sent.Message);

        _sender.Last.Returns(new PushSendReport(_time.GetUtcNow(), "test", 0, 0, 1, 0, 403));
        var refused = await Delivery().RunAsync(false, default);
        Assert.Equal(HealthStatus.Warning, refused.Status);
        Assert.StartsWith("A test notification just now wasn't delivered: the push service refused it (HTTP 403).", refused.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Webhook_CallingLumen_WithTheSecret_AndRequestAvailable_IsOk()
    {
        Webhook(new SeerrWebhook(true, SeerrWebhook.MediaAvailable | 2, "http://jellyfin:8096/base/Lumen/Push/Seerr/", "Bearer " + Secret));

        var result = await WebhookCheck().RunAsync(false, default);

        Assert.Equal(HealthStatus.Ok, result.Status);
        Assert.DoesNotContain(Secret, result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Webhook_WithAnotherSecret_IsAProblem_WithoutNamingEither()
    {
        Webhook(new SeerrWebhook(true, SeerrWebhook.MediaAvailable, "http://jellyfin:8096/Lumen/Push/Seerr", "old-secret"));

        var result = await WebhookCheck().RunAsync(false, default);

        Assert.Equal(HealthStatus.Problem, result.Status);
        Assert.DoesNotContain("old-secret", result.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(Secret, result.Message, StringComparison.Ordinal);
        Assert.Equal("requests", result.Fix!.Target);
    }

    [Fact]
    public async Task Webhook_WithoutRequestAvailable_Warns()
    {
        Webhook(new SeerrWebhook(true, 2 | 4, "http://jellyfin:8096/Lumen/Push/Seerr", Secret));

        Assert.Equal(HealthStatus.Warning, (await WebhookCheck().RunAsync(false, default)).Status);
    }

    [Theory]
    [InlineData(false, "http://jellyfin:8096/Lumen/Push/Seerr", "Seerr's webhook is off.")]
    [InlineData(true, "https://discord.com/api/webhooks/1/abc", "Seerr's webhook goes somewhere other than Lumen.")]
    public async Task Webhook_OffOrElsewhere_IsOptional(bool enabled, string url, string start)
    {
        Webhook(new SeerrWebhook(enabled, SeerrWebhook.MediaAvailable, url, null));

        var result = await WebhookCheck().RunAsync(false, default);

        Assert.Equal(HealthStatus.NotApplicable, result.Status);
        Assert.StartsWith(start, result.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("discord", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Webhook_Unreadable_IsNotApplicable()
    {
        _seerr.GetWebhookAsync(default!, default).ThrowsAsyncForAnyArgs(new SeerrException("Seerr rejected the API key."));

        Assert.Equal("Couldn't read Seerr's webhook settings.", (await WebhookCheck().RunAsync(false, default)).Message);
    }

    private static PluginConfiguration Config(bool requests = true) =>
        new() { RequestsEnabled = requests, SeerrUrl = "http://seerr:5055", SeerrApiKey = "key", PushWebhookSecret = Secret };

    private void Webhook(SeerrWebhook webhook) => _seerr.GetWebhookAsync(default!, default).ReturnsForAnyArgs(webhook);

    private IHealthCheck[] Checks() => [Service(), Devices(), Delivery(), WebhookCheck()];

    private PushServiceCheck Service() => new(_config, _signal);

    private PushDevicesCheck Devices() => new(_config, _subscriptions);

    private PushDeliveryCheck Delivery() => new(_config, _sender, _time);

    private SeerrWebhookCheck WebhookCheck() => new(_config, _seerr);
}
