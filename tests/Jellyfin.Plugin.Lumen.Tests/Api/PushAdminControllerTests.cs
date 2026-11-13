using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Push;
using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using Xunit;
using static Jellyfin.Plugin.Lumen.Tests.Push.PushSubscriptionStoreTests;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public sealed class PushAdminControllerTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "lumen-push-" + Guid.NewGuid().ToString("N"));
    private readonly ILumenConfigStore _config = Substitute.For<ILumenConfigStore>();
    private readonly IPushSender _sender = Substitute.For<IPushSender>();
    private readonly PushSubscriptionStore _store;
    private readonly ReadyPushSignal _signal;
    private readonly PushAdminController _controller;
    private PushSecrets _secrets = new(VapidKeys.Generate(), "first-secret");

    public PushAdminControllerTests()
    {
        _store = new PushSubscriptionStore(Path.Combine(_dir, "push-subscriptions.json"), NullLogger<PushSubscriptionStore>.Instance);
        _signal = new ReadyPushSignal(_store) { Running = true };
        _config.Current.Returns(new PluginConfiguration { RequestsEnabled = true, SeerrUrl = "http://seerr:5055", SeerrApiKey = "k" });
        _config.GetPushSecrets().Returns(_ => _secrets);
        _config.ResetPushSecrets().Returns(_ => _secrets = new PushSecrets(VapidKeys.Generate(), "second-secret"));
        _controller = new PushAdminController(_config, _store, _sender, _signal);
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, true);
        }
    }

    [Fact]
    public void Status_CountsDevicesAndUsers_AndShowsTheLastSend()
    {
        var (alice, bob) = (Guid.NewGuid(), Guid.NewGuid());
        _store.Save(alice, Subscription("phone", "https://web.push.apple.com/a"));
        _store.Save(alice, Subscription("laptop", "https://fcm.googleapis.com/fcm/send/b"));
        _store.Save(bob, Subscription("bobs", "https://web.push.apple.com/c"));
        var last = new PushSendReport(TestData.Now, "ready", 2, 0, 0, 1, 503);
        _sender.Last.Returns(last);

        var status = _controller.GetStatus().Value!;

        Assert.Equal(new PushAdminStatusDto(3, 2, true, last, "Lumen/Push/Seerr", "first-secret"), status);
    }

    [Fact]
    public void Status_NeverCarriesAKeyOrAnAddress()
    {
        _store.Save(Guid.NewGuid(), Subscription("phone", "https://web.push.apple.com/QGcapability"));

        var json = System.Text.Json.JsonSerializer.Serialize(_controller.GetStatus().Value);

        Assert.DoesNotContain(_secrets.Keys.PrivateKey, json, StringComparison.Ordinal);
        Assert.DoesNotContain("QGcapability", json, StringComparison.Ordinal);
        Assert.DoesNotContain("p256", json, StringComparison.Ordinal);
    }

    [Fact]
    public void Status_WithoutSeerr_MakesNoKeys()
    {
        _config.Current.Returns(new PluginConfiguration());

        var status = _controller.GetStatus().Value!;

        Assert.Null(status.WebhookSecret);
        _config.DidNotReceive().GetPushSecrets();
    }

    [Fact]
    public void ResetKeys_ReplacesTheKeys_AndDropsEverySubscription()
    {
        _store.Save(Guid.NewGuid(), Subscription("phone", "https://web.push.apple.com/a"));
        _store.Save(Guid.NewGuid(), Subscription("laptop", "https://fcm.googleapis.com/fcm/send/b"));

        var status = _controller.ResetKeys().Value!;

        _config.Received(1).ResetPushSecrets();
        Assert.Equal((0, 0, "second-secret"), (status.Devices, status.Users, status.WebhookSecret));
        Assert.Equal((0, 0), _store.Count());
    }
}
