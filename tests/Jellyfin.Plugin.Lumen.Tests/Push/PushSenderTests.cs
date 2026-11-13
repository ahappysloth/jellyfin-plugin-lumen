using Jellyfin.Plugin.Lumen.Push;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;
using static Jellyfin.Plugin.Lumen.Tests.Push.PushSubscriptionStoreTests;

namespace Jellyfin.Plugin.Lumen.Tests.Push;

public sealed class PushSenderTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "lumen-push-" + Guid.NewGuid().ToString("N"));
    private readonly PushSubscriptionStore _store;
    private readonly IWebPushClient _client = Substitute.For<IWebPushClient>();
    private readonly ISignedInDevices _signedIn = Substitute.For<ISignedInDevices>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly PushSender _sender;
    private readonly Guid _alice = Guid.NewGuid();
    private readonly Guid _bob = Guid.NewGuid();

    public PushSenderTests()
    {
        _store = new PushSubscriptionStore(Path.Combine(_dir, "push-subscriptions.json"), NullLogger<PushSubscriptionStore>.Instance);
        _signedIn.IsSignedIn(default, default!).ReturnsForAnyArgs(true);
        Answer(PushOutcome.Sent, 201);
        _sender = new PushSender(_store, _client, _signedIn, _time, NullLogger<PushSender>.Instance);
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, true);
        }
    }

    [Fact]
    public async Task Send_GoesToEveryDeviceOfThatUser_AndNobodyElses()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        _store.Save(_alice, Subscription("laptop", "https://fcm.googleapis.com/fcm/send/b"));
        _store.Save(_bob, Subscription("bobs", "https://web.push.apple.com/c"));

        var result = await _sender.SendAsync(_alice, _ => PushMessage.Test(), TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.Equal(new PushSendResult(2, 0, 0, 0), result);
        Assert.True(result.Delivered);
        await _client.Received(1).SendAsync(Arg.Is<PushSubscription>(s => s.DeviceId == "phone"), Arg.Any<ReadOnlyMemory<byte>>(), TimeSpan.FromMinutes(1), Arg.Any<CancellationToken>());
        await _client.Received(1).SendAsync(Arg.Is<PushSubscription>(s => s.DeviceId == "laptop"), Arg.Any<ReadOnlyMemory<byte>>(), Arg.Any<TimeSpan>(), Arg.Any<CancellationToken>());
        await _client.DidNotReceive().SendAsync(Arg.Is<PushSubscription>(s => s.DeviceId == "bobs"), Arg.Any<ReadOnlyMemory<byte>>(), Arg.Any<TimeSpan>(), Arg.Any<CancellationToken>());
        Assert.Equal(new PushSendReport(TestData.Now, "test", 2, 0, 0, 0, null), _sender.Last);
    }

    [Fact]
    public async Task Send_ToOneDevice_LeavesTheOthersAlone()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        _store.Save(_alice, Subscription("laptop", "https://fcm.googleapis.com/fcm/send/b"));

        var result = await _sender.SendAsync(_alice, _ => PushMessage.Test(), TimeSpan.FromMinutes(1), CancellationToken.None, "laptop");

        Assert.Equal(1, result.Sent);
        await _client.DidNotReceive().SendAsync(Arg.Is<PushSubscription>(s => s.DeviceId == "phone"), Arg.Any<ReadOnlyMemory<byte>>(), Arg.Any<TimeSpan>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(404)]
    [InlineData(410)]
    public async Task ASubscriptionThePushServiceSaysIsGone_IsRemoved(int status)
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/gone"));
        _store.Save(_alice, Subscription("laptop", "https://fcm.googleapis.com/fcm/send/b"));
        _client.SendAsync(Arg.Is<PushSubscription>(s => s.DeviceId == "phone"), Arg.Any<ReadOnlyMemory<byte>>(), Arg.Any<TimeSpan>(), Arg.Any<CancellationToken>())
            .Returns(new PushResult(PushOutcome.Gone, status));

        var result = await _sender.SendAsync(_alice, _ => PushMessage.Test(), TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.Equal(new PushSendResult(1, 1, 0, 0, status), result);
        Assert.Equal(["laptop"], _store.ForUser(_alice).Select(s => s.DeviceId));
        Assert.Equal(status, _sender.Last!.Status);
    }

    [Fact]
    public async Task WhenEveryDeviceIsGone_NothingWasDelivered_AndTheUserHasNoSubscriptionLeft()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/gone"));
        Answer(PushOutcome.Gone, 410);

        var result = await _sender.SendAsync(_alice, _ => PushMessage.Test(), TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.False(result.Delivered);
        Assert.False(_store.HasAny(_alice));
    }

    [Fact]
    public async Task AFailure_KeepsTheSubscription_ForTheNextTry()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        Answer(PushOutcome.Failed, 503);

        var result = await _sender.SendAsync(_alice, _ => PushMessage.Test(), TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.Equal(new PushSendResult(0, 0, 0, 1, 503), result);
        Assert.True(_store.HasAny(_alice));
    }

    [Fact]
    public async Task ASubscriptionRefusedThreeTimesRunning_IsRemoved_ButNotBefore()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        Answer(PushOutcome.Rejected, 403);

        await Send();
        await Send();
        Assert.True(_store.HasAny(_alice));

        // Taken once in between: the count starts over.
        Answer(PushOutcome.Sent, 201);
        await Send();
        Answer(PushOutcome.Rejected, 403);
        await Send();
        await Send();
        Assert.True(_store.HasAny(_alice));

        await Send();
        Assert.False(_store.HasAny(_alice));
    }

    [Fact]
    public async Task ADeviceTheUserSignedOutOf_IsRemoved_AndSentNothing()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        _store.Save(_alice, Subscription("signed-out", "https://fcm.googleapis.com/fcm/send/b"));
        _signedIn.IsSignedIn(_alice, "signed-out").Returns(false);

        var result = await Send();

        Assert.Equal(1, result.Sent);
        Assert.Equal(["phone"], _store.ForUser(_alice).Select(s => s.DeviceId));
        await _client.DidNotReceive().SendAsync(Arg.Is<PushSubscription>(s => s.DeviceId == "signed-out"), Arg.Any<ReadOnlyMemory<byte>>(), Arg.Any<TimeSpan>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Send_WithNoDevices_SendsNothing_AndReportsNothing()
    {
        var result = await Send();

        Assert.Equal(new PushSendResult(0, 0, 0, 0), result);
        Assert.Null(_sender.Last);
        await _client.DidNotReceiveWithAnyArgs().SendAsync(default!, default, default, default);
    }

    [Fact]
    public async Task EachDevice_GetsTheMessageMadeForIt()
    {
        _store.Save(_alice, Subscription("german", "https://web.push.apple.com/a", "de-DE"));
        var payloads = new List<string>();
        _client.SendAsync(default!, default, default, default).ReturnsForAnyArgs(call =>
        {
            payloads.Add(System.Text.Encoding.UTF8.GetString(call.ArgAt<ReadOnlyMemory<byte>>(1).Span));
            return new PushResult(PushOutcome.Sent, 201);
        });

        await _sender.SendAsync(_alice, device => PushMessage.Test() with { Title = "for " + device.Locale }, TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.Contains("\"title\":\"for de-DE\"", Assert.Single(payloads), StringComparison.Ordinal);
    }

    private Task<PushSendResult> Send() => _sender.SendAsync(_alice, _ => PushMessage.Test(), TimeSpan.FromMinutes(1), CancellationToken.None);

    private void Answer(PushOutcome outcome, int status) =>
        _client.SendAsync(default!, default, default, default).ReturnsForAnyArgs(new PushResult(outcome, status));
}
