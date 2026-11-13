using Jellyfin.Plugin.Lumen.Push;
using Microsoft.Extensions.Logging;
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
    private readonly ListLogger<PushSender> _log = new();
    private readonly PushSender _sender;
    private readonly Guid _alice = Guid.NewGuid();
    private readonly Guid _bob = Guid.NewGuid();

    public PushSenderTests()
    {
        _store = new PushSubscriptionStore(Path.Combine(_dir, "push-subscriptions.json"), NullLogger<PushSubscriptionStore>.Instance);
        _signedIn.IsSignedIn(default, default!).ReturnsForAnyArgs(true);
        Answer(PushOutcome.Sent, 201);
        _sender = new PushSender(_store, _client, _signedIn, _time, _log);
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

        var result = await _sender.SendAsync(_alice, PushMessage.Test(), TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.Equal((2, 0, 0, 0, null), Counts(result));
        Assert.True(result.Delivered);
        Assert.Equal(
            [new PushDeviceResult("laptop", PushOutcome.Sent, 201, false), new PushDeviceResult("phone", PushOutcome.Sent, 201, false)],
            result.Devices.OrderBy(d => d.DeviceId));
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

        var result = await _sender.SendAsync(_alice, PushMessage.Test(), TimeSpan.FromMinutes(1), CancellationToken.None, ["laptop", "a-device-since-turned-off"]);

        Assert.Equal(1, result.Sent);
        Assert.Equal("laptop", Assert.Single(result.Devices).DeviceId);
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

        var result = await _sender.SendAsync(_alice, PushMessage.Test(), TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.Equal((1, 1, 0, 0, status), Counts(result));
        Assert.Equal(["laptop"], _store.ForUser(_alice).Select(s => s.DeviceId));

        // The one that's gone was removed, and is owed nothing more; the other one has it.
        var gone = result.Devices.Single(d => d.DeviceId == "phone");
        Assert.Equal((PushOutcome.Gone, true, false), (gone.Outcome, gone.Removed, gone.Owed));
        Assert.False(result.Devices.Single(d => d.DeviceId == "laptop").Owed);
        Assert.Equal(status, _sender.Last!.Status);
    }

    [Fact]
    public async Task WhenEveryDeviceIsGone_NothingWasDelivered_AndTheUserHasNoSubscriptionLeft()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/gone"));
        Answer(PushOutcome.Gone, 410);

        var result = await _sender.SendAsync(_alice, PushMessage.Test(), TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.False(result.Delivered);
        Assert.False(_store.HasAny(_alice));
    }

    [Fact]
    public async Task AFailure_KeepsTheSubscription_ForTheNextTry()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        Answer(PushOutcome.Failed, 503);

        var result = await _sender.SendAsync(_alice, PushMessage.Test(), TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.Equal((0, 0, 0, 1, 503), Counts(result));
        Assert.True(_store.HasAny(_alice));
        Assert.True(Assert.Single(result.Devices).Owed);
    }

    [Fact]
    public async Task WithSeveralDevices_EachHasItsOwnResult_OneTakingItSaysNothingOfTheOther()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        _store.Save(_alice, Subscription("laptop", "https://fcm.googleapis.com/fcm/send/b"));
        AnswerFor("laptop", PushOutcome.Failed, 503);

        var result = await Send();

        Assert.True(result.Delivered);
        Assert.Equal((1, 0, 0, 1, 503), Counts(result));
        Assert.Equal(["laptop"], result.Devices.Where(d => d.Owed).Select(d => d.DeviceId));
        Assert.Equal(new PushSendReport(TestData.Now, "test", 1, 0, 0, 1, 503), _sender.Last);
    }

    [Fact]
    public async Task ADeviceThatCantBeReached_IsLoggedOncePerStreak_NotPerAttempt()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/QGcapability"));
        _store.Save(_alice, Subscription("laptop", "https://fcm.googleapis.com/fcm/send/b"));
        AnswerFor("phone", PushOutcome.Failed, 503);

        for (var i = 0; i < 5; i++)
        {
            await Send();
        }

        // One warning for the phone, however often it was tried; never its address, only the push service's host.
        var warning = Assert.Single(_log.Entries, e => e.Level == LogLevel.Warning);
        Assert.Contains("web.push.apple.com", warning.Message, StringComparison.Ordinal);
        Assert.Contains("503", warning.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("QGcapability", warning.Message, StringComparison.Ordinal);

        // It works again (logged, once), then fails again: a new streak, one more warning.
        AnswerFor("phone", PushOutcome.Sent, 201);
        await Send();
        await Send();
        Assert.Single(_log.Entries, e => e.Level == LogLevel.Information);
        AnswerFor("phone", PushOutcome.Failed, null);
        await Send();
        await Send();
        Assert.Equal(2, _log.Entries.Count(e => e.Level == LogLevel.Warning));
    }

    [Fact]
    public async Task TwoDevicesFailing_AreLoggedOnceEach()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        _store.Save(_alice, Subscription("laptop", "https://fcm.googleapis.com/fcm/send/b"));
        Answer(PushOutcome.Failed, 503);

        await Send();
        await Send();
        await Send();

        Assert.Equal(2, _log.Entries.Count(e => e.Level == LogLevel.Warning));
    }

    [Fact]
    public async Task ARefusal_IsLoggedWhenItStarts_NotEveryTime()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        Answer(PushOutcome.Rejected, 403);

        await Send();
        await Send();

        Assert.Single(_log.Entries, e => e.Level == LogLevel.Warning);
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

        var last = await Send();
        Assert.False(_store.HasAny(_alice));
        Assert.Equal((true, false), (last.Devices[0].Removed, last.Devices[0].Owed));
    }

    [Fact]
    public async Task TurningNotificationsOff_ForgetsWhatWasCountedAgainstTheAddress()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        Answer(PushOutcome.Rejected, 403);
        await Send();
        await Send();

        // Off and on again, and the browser hands back the address it had: it starts with a clean slate.
        _store.Remove(_alice, "phone");
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        await Send();
        await Send();
        Assert.True(_store.HasAny(_alice));

        await Send();
        Assert.False(_store.HasAny(_alice));
    }

    [Fact]
    public async Task AfterTheKeysAreReset_AFailingDevicesNextTroubleIsLoggedAgain()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        Answer(PushOutcome.Failed, 503);
        await Send();

        _store.Clear();
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        await Send();

        Assert.Equal(2, _log.Entries.Count(e => e.Level == LogLevel.Warning));
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
    public async Task EveryDevice_GetsTheSameMessage()
    {
        _store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        _store.Save(_alice, Subscription("laptop", "https://fcm.googleapis.com/fcm/send/b"));
        var payloads = new List<string>();
        _client.SendAsync(default!, default, default, default).ReturnsForAnyArgs(call =>
        {
            lock (payloads)
            {
                payloads.Add(System.Text.Encoding.UTF8.GetString(call.ArgAt<ReadOnlyMemory<byte>>(1).Span));
            }

            return new PushResult(PushOutcome.Sent, 201);
        });

        await _sender.SendAsync(_alice, PushMessage.Test() with { Title = "Dune is ready to watch" }, TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.Equal(2, payloads.Count);
        Assert.All(payloads, p => Assert.Contains("\"title\":\"Dune is ready to watch\"", p, StringComparison.Ordinal));
    }

    private static (int Sent, int Gone, int Rejected, int Failed, int? Status) Counts(PushSendResult result) =>
        (result.Sent, result.Gone, result.Rejected, result.Failed, result.Status);

    private Task<PushSendResult> Send() => _sender.SendAsync(_alice, PushMessage.Test(), TimeSpan.FromMinutes(1), CancellationToken.None);

    private void Answer(PushOutcome outcome, int status) =>
        _client.SendAsync(default!, default, default, default).ReturnsForAnyArgs(new PushResult(outcome, status));

    private void AnswerFor(string device, PushOutcome outcome, int? status) =>
        _client.SendAsync(Arg.Is<PushSubscription>(s => s.DeviceId == device), Arg.Any<ReadOnlyMemory<byte>>(), Arg.Any<TimeSpan>(), Arg.Any<CancellationToken>())
            .Returns(new PushResult(outcome, status));
}
