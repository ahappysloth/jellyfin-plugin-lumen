using System.Buffers.Text;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Push;
using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public sealed class PushControllerTests : IDisposable
{
    private const string Apple = "https://web.push.apple.com/QGdevice";
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/"), "key123");
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "lumen-push-" + Guid.NewGuid().ToString("N"));
    private readonly ISeerrUserMap _users = Substitute.For<ISeerrUserMap>();
    private readonly ILumenConfigStore _config = Substitute.For<ILumenConfigStore>();
    private readonly IPushSender _sender = Substitute.For<IPushSender>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly ISignedInDevices _devices = Substitute.For<ISignedInDevices>();
    private readonly ListLogger<ReadyPushSignal> _signalLog = new();

    /// <summary>The access tokens Jellyfin has issued: whose each is, and for which device.</summary>
    private readonly Dictionary<string, (Guid User, SessionDevice Device)> _tokens = [];
    private readonly PushSubscriptionStore _store;
    private readonly ReadyPushSignal _signal;
    private readonly PushTestLimiter _limiter;
    private readonly PushSubscribeLimiter _subscribeLimiter;
    private readonly PushSecrets _secrets = new(VapidKeys.Generate(), "webhook-secret-value");
    private readonly Guid _alice = Guid.NewGuid();
    private readonly Guid _bob = Guid.NewGuid();
    private readonly string _p256dh;
    private readonly string _auth = Base64Url.EncodeToString(new byte[16]);

    public PushControllerTests()
    {
        _store = new PushSubscriptionStore(Path.Combine(_dir, "push-subscriptions.json"), NullLogger<PushSubscriptionStore>.Instance);
        _signal = new ReadyPushSignal(_store, _signalLog);
        _limiter = new PushTestLimiter(_time);
        _subscribeLimiter = new PushSubscribeLimiter(_time);

        // As Jellyfin's device list: a token is one user's, for one device, whatever a request claims beside it.
        _devices.ForToken(default, default, default).ReturnsForAnyArgs(call =>
            call.ArgAt<string?>(1) is { } token && _tokens.TryGetValue(token, out var issued) && issued.User == call.ArgAt<Guid>(0) ? issued.Device : null);
        _config.GetPushSecrets().Returns(_secrets);
        _config.Current.Returns(new PluginConfiguration { PushWebhookSecret = _secrets.WebhookSecret });
        _users.GetAccessAsync(default, default).ReturnsForAnyArgs(new RequestAccess(true, true, true, 9, Endpoint));
        using var key = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        _p256dh = Base64Url.EncodeToString(WebPushEncryption.ExportPublicKey(key));
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, true);
        }
    }

    [Fact]
    public void Worker_IsServedUncached_FromItsOwnPath()
    {
        var controller = Create(null, null);

        var file = Assert.IsType<FileContentResult>(controller.GetWorker());

        Assert.Equal("text/javascript; charset=utf-8", file.ContentType);
        Assert.Equal("self.addEventListener('push', function () {});", Encoding.UTF8.GetString(file.FileContents));
        Assert.Equal("no-cache", controller.Response.Headers.CacheControl.ToString());

        // Its scope comes from where it's served: /Lumen/Push/, nowhere near jellyfin-web's /web/.
        Assert.Equal("Lumen/Push", Assert.Single(typeof(PushController).GetCustomAttributes(typeof(RouteAttribute), false).Cast<RouteAttribute>()).Template);
    }

    [Fact]
    public async Task EveryUserEndpoint_NeedsAJellyfinUser()
    {
        var controller = Create(null, "phone");

        Assert.IsType<UnauthorizedResult>((await controller.GetStatus(CancellationToken.None)).Result);
        Assert.IsType<UnauthorizedResult>(await controller.Subscribe(Body(), CancellationToken.None));
        Assert.IsType<UnauthorizedResult>(controller.Unsubscribe());
        Assert.IsType<UnauthorizedResult>((await controller.SendTest(CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Status_GivesThePublicKey_AndThisDevicesAddress_NeverThePrivateKey()
    {
        await Create(_alice, "phone").Subscribe(Body(), CancellationToken.None);
        var controller = Create(_alice, "phone");

        var status = (await controller.GetStatus(CancellationToken.None)).Value!;

        Assert.Equal(new PushStatusDto(true, _secrets.Keys.PublicKey, Apple), status);
        Assert.Equal("no-store", controller.Response.Headers.CacheControl.ToString());
        Assert.DoesNotContain(_secrets.Keys.PrivateKey, System.Text.Json.JsonSerializer.Serialize(status), StringComparison.Ordinal);

        // Another device of the same user, and another user on a device with the same id, see nothing of it.
        Assert.Null((await Create(_alice, "laptop").GetStatus(CancellationToken.None)).Value!.Endpoint);
        Assert.Null((await Create(_bob, "phone").GetStatus(CancellationToken.None)).Value!.Endpoint);
    }

    [Fact]
    public async Task Status_WithoutRequestFeatures_IsUnavailable_AndMakesNoKeys()
    {
        _users.GetAccessAsync(_alice, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        var status = (await Create(_alice, "phone").GetStatus(CancellationToken.None)).Value!;

        Assert.Equal(new PushStatusDto(false, null, null), status);
        _config.DidNotReceive().GetPushSecrets();
    }

    [Fact]
    public async Task Subscribe_StoresTheSubscription_ForTheSignedInUserAndDevice()
    {
        var result = await Create(_alice, "phone", "Safari iOS").Subscribe(Body(), CancellationToken.None);

        Assert.IsType<NoContentResult>(result);
        Assert.Equal(new PushSubscription(Apple, _p256dh, _auth, "phone", "Safari iOS", TestData.Now), Assert.Single(_store.ForUser(_alice)));
        Assert.False(_store.HasAny(_bob));
    }

    [Fact]
    public async Task TheDevice_IsTheOneTheTokenWasIssuedTo_NotTheOneTheRequestClaimsToBe()
    {
        await Create(_alice, "phone").Subscribe(Body(), CancellationToken.None);
        _sender.SendAsync(default, default!, default, default, default).ReturnsForAnyArgs(new PushSendResult(1, 0, 0, 0));

        // Alice's laptop session, with an Authorization header that names her phone's device id.
        PushController Laptop() => Create(_alice, "laptop", claims: "phone");

        // It sees nothing of the phone's subscription, and can't remove or test it.
        Assert.Null((await Laptop().GetStatus(CancellationToken.None)).Value!.Endpoint);
        Assert.IsType<NoContentResult>(Laptop().Unsubscribe());
        Assert.IsType<NotFoundResult>((await Laptop().SendTest(CancellationToken.None)).Result);
        Assert.Equal(Apple, Assert.Single(_store.ForUser(_alice)).Endpoint);

        // What it subscribes is the laptop's, beside the phone's, not in its place.
        Assert.IsType<NoContentResult>(await Laptop().Subscribe(Body("https://fcm.googleapis.com/fcm/send/laptop"), CancellationToken.None));
        Assert.Equal(["phone", "laptop"], _store.ForUser(_alice).Select(s => s.DeviceId));
        Assert.Equal(Apple, _store.ForDevice(_alice, "phone")!.Endpoint);
        Assert.Equal("https://fcm.googleapis.com/fcm/send/laptop", (await Laptop().GetStatus(CancellationToken.None)).Value!.Endpoint);

        Assert.True((await Laptop().SendTest(CancellationToken.None)).Value!.Ok);
        await _sender.Received(1).SendAsync(_alice, Arg.Any<PushMessage>(), Arg.Any<TimeSpan>(), Arg.Any<CancellationToken>(), Arg.Is<IReadOnlyCollection<string>>(d => d.Single() == "laptop"));
        Laptop().Unsubscribe();
        Assert.Equal(["phone"], _store.ForUser(_alice).Select(s => s.DeviceId));
    }

    [Fact]
    public async Task ASignInThatIsntADevices_AnApiKeySay_HasNoSubscription_WhateverDeviceItClaims()
    {
        await Create(_alice, "phone").Subscribe(Body(), CancellationToken.None);

        // A token Jellyfin's device list doesn't have for this user, on a request that names the phone.
        PushController Key() => Create(_alice, null, claims: "phone", token: "an-api-key");

        Assert.Null((await Key().GetStatus(CancellationToken.None)).Value!.Endpoint);
        Assert.IsType<BadRequestObjectResult>(await Key().Subscribe(Body("https://fcm.googleapis.com/fcm/send/x"), CancellationToken.None));
        Key().Unsubscribe();
        Assert.IsType<NotFoundResult>((await Key().SendTest(CancellationToken.None)).Result);
        Assert.Equal(Apple, Assert.Single(_store.ForUser(_alice)).Endpoint);

        // Nor does Bob's token act as Alice's device, were it ever to carry her user id.
        _tokens["bobs-token"] = (_bob, new SessionDevice("phone", null));
        Assert.Null((await Create(_alice, null, claims: "phone", token: "bobs-token").GetStatus(CancellationToken.None)).Value!.Endpoint);
    }

    [Fact]
    public async Task Subscribe_IsRateLimitedPerUser_CountingOnlyWhatIsStored()
    {
        // Refused ones cost nothing and don't count.
        for (var i = 0; i < 2 * PushSubscribeLimiter.MaxPerWindow; i++)
        {
            Assert.IsType<BadRequestObjectResult>(await Create(_alice, "phone").Subscribe(Body("https://example.com/push"), CancellationToken.None));
        }

        for (var i = 0; i < PushSubscribeLimiter.MaxPerWindow; i++)
        {
            Assert.IsType<NoContentResult>(await Create(_alice, "phone").Subscribe(Body("https://web.push.apple.com/" + i), CancellationToken.None));
            _time.Advance(TimeSpan.FromSeconds(1));
        }

        var controller = Create(_alice, "phone");
        var limited = Assert.IsType<ObjectResult>(await controller.Subscribe(Body("https://web.push.apple.com/one-more"), CancellationToken.None));

        Assert.Equal(StatusCodes.Status429TooManyRequests, limited.StatusCode);
        Assert.IsType<ErrorDto>(limited.Value);
        Assert.Equal("40", controller.Response.Headers.RetryAfter.ToString());
        Assert.Equal("https://web.push.apple.com/19", Assert.Single(_store.ForUser(_alice)).Endpoint);

        // Bob isn't held back by Alice, turning off is never limited, and Alice may again a minute after her first.
        Assert.IsType<NoContentResult>(await Create(_bob, "bobs").Subscribe(Body("https://fcm.googleapis.com/fcm/send/bob"), CancellationToken.None));
        Assert.IsType<NoContentResult>(Create(_alice, "phone").Unsubscribe());
        _time.Advance(TimeSpan.FromSeconds(40));
        Assert.IsType<NoContentResult>(await Create(_alice, "phone").Subscribe(Body(), CancellationToken.None));
    }

    [Theory]
    [InlineData("http://localhost:8096/Users")]
    [InlineData("https://192.168.1.2/x")]
    [InlineData("https://seerr.internal/api/v1/request")]
    [InlineData("")]
    [InlineData(null)]
    public async Task Subscribe_RefusesAnAddressThatIsntAPushService(string? endpoint)
    {
        var result = await Create(_alice, "phone").Subscribe(Body(endpoint), CancellationToken.None);

        Assert.IsType<ErrorDto>(Assert.IsType<BadRequestObjectResult>(result).Value);
        Assert.False(_store.HasAny(_alice));
    }

    [Fact]
    public async Task Subscribe_RefusesBadKeys_AMissingBody_AndASignInWithoutADevice()
    {
        Assert.IsType<BadRequestObjectResult>(await Create(_alice, "phone").Subscribe(new PushSubscribeDto(Apple, "AAAA", _auth), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await Create(_alice, "phone").Subscribe(new PushSubscribeDto(Apple, _p256dh, "AAAA"), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await Create(_alice, "phone").Subscribe(null, CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await Create(_alice, null).Subscribe(Body(), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await Create(_alice, new string('d', 300)).Subscribe(Body(), CancellationToken.None));
        Assert.False(_store.HasAny(_alice));
    }

    [Fact]
    public async Task Subscribe_WithoutRequestFeatures_IsNotFound()
    {
        _users.GetAccessAsync(_alice, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        Assert.IsType<NotFoundResult>(await Create(_alice, "phone").Subscribe(Body(), CancellationToken.None));
        Assert.False(_store.HasAny(_alice));
    }

    [Fact]
    public async Task Unsubscribe_RemovesOnlyTheCallersOwnDevice()
    {
        await Create(_alice, "phone").Subscribe(Body(), CancellationToken.None);
        await Create(_alice, "laptop").Subscribe(Body("https://fcm.googleapis.com/fcm/send/laptop"), CancellationToken.None);
        await Create(_bob, "bobs").Subscribe(Body("https://fcm.googleapis.com/fcm/send/bob"), CancellationToken.None);

        // Bob, signed in on a device that happens to share Alice's device id, removes nothing of hers.
        Assert.IsType<NoContentResult>(Create(_bob, "phone").Unsubscribe());
        Assert.Equal(2, _store.ForUser(_alice).Count);

        Assert.IsType<NoContentResult>(Create(_alice, "phone").Unsubscribe());
        Assert.IsType<NoContentResult>(Create(_alice, "phone").Unsubscribe()); // fine to repeat
        Assert.Equal(["laptop"], _store.ForUser(_alice).Select(s => s.DeviceId));
        Assert.Single(_store.ForUser(_bob));
    }

    [Fact]
    public async Task Unsubscribe_WorksWithoutRequestFeatures()
    {
        await Create(_alice, "phone").Subscribe(Body(), CancellationToken.None);
        _users.GetAccessAsync(_alice, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        Create(_alice, "phone").Unsubscribe();

        Assert.False(_store.HasAny(_alice));
    }

    [Fact]
    public async Task Test_SendsToThisDeviceOnly()
    {
        await Create(_alice, "phone").Subscribe(Body(), CancellationToken.None);
        _sender.SendAsync(default, default!, default, default, default).ReturnsForAnyArgs(new PushSendResult(1, 0, 0, 0));

        var result = (await Create(_alice, "phone").SendTest(CancellationToken.None)).Value!;

        Assert.Equal(new PushTestResultDto(true, null), result);
        await _sender.Received(1).SendAsync(
            _alice,
            Arg.Is<PushMessage>(m => m.Kind == PushMessage.TestKind),
            PushController.TestTimeToLive,
            Arg.Any<CancellationToken>(),
            Arg.Is<IReadOnlyCollection<string>>(d => d.Single() == "phone"));
    }

    [Fact]
    public async Task Test_OnADeviceThatIsntSubscribed_IsNotFound()
    {
        await Create(_alice, "phone").Subscribe(Body(), CancellationToken.None);

        Assert.IsType<NotFoundResult>((await Create(_alice, "laptop").SendTest(CancellationToken.None)).Result);
        Assert.IsType<NotFoundResult>((await Create(_bob, "phone").SendTest(CancellationToken.None)).Result);
        await _sender.DidNotReceiveWithAnyArgs().SendAsync(default, default!, default, default, default);
    }

    [Fact]
    public async Task Test_IsRateLimitedPerUser()
    {
        await Create(_alice, "phone").Subscribe(Body(), CancellationToken.None);
        await Create(_bob, "bobs").Subscribe(Body("https://fcm.googleapis.com/fcm/send/bob"), CancellationToken.None);
        _sender.SendAsync(default, default!, default, default, default).ReturnsForAnyArgs(new PushSendResult(1, 0, 0, 0));

        Assert.True((await Create(_alice, "phone").SendTest(CancellationToken.None)).Value!.Ok);
        var controller = Create(_alice, "phone");
        var limited = Assert.IsType<ObjectResult>((await controller.SendTest(CancellationToken.None)).Result);

        Assert.Equal(StatusCodes.Status429TooManyRequests, limited.StatusCode);
        Assert.Equal("10", controller.Response.Headers.RetryAfter.ToString());
        await _sender.Received(1).SendAsync(_alice, Arg.Any<PushMessage>(), Arg.Any<TimeSpan>(), Arg.Any<CancellationToken>(), Arg.Any<IReadOnlyCollection<string>>());

        // Bob isn't held back by Alice's tests, and Alice may again after the gap.
        Assert.True((await Create(_bob, "bobs").SendTest(CancellationToken.None)).Value!.Ok);
        _time.Advance(PushTestLimiter.MinGap);
        Assert.True((await Create(_alice, "phone").SendTest(CancellationToken.None)).Value!.Ok);
    }

    [Theory]
    [InlineData(0, 1, 0, 0, PushTestResultDto.Gone)]
    [InlineData(0, 0, 1, 0, PushTestResultDto.Rejected)]
    [InlineData(0, 0, 0, 1, PushTestResultDto.Unreachable)]
    [InlineData(0, 0, 0, 0, PushTestResultDto.Unreachable)]
    public async Task Test_SaysWhyItDidntArrive(int sent, int gone, int rejected, int failed, string error)
    {
        await Create(_alice, "phone").Subscribe(Body(), CancellationToken.None);
        _sender.SendAsync(default, default!, default, default, default).ReturnsForAnyArgs(new PushSendResult(sent, gone, rejected, failed));

        Assert.Equal(new PushTestResultDto(false, error), (await Create(_alice, "phone").SendTest(CancellationToken.None)).Value);
    }

    [Fact]
    public void Test_WhenTheSubscriptionIsGone_SaysToTurnNotificationsOn_NotOffAndOn()
    {
        // The server has dropped the device by then: its switch shows off, and turning it on makes a new subscription
        // (client/src/views/push/push.ts). "Off and on again" would ask for a step that isn't there.
        Assert.DoesNotContain("off and on", PushTestResultDto.Gone, StringComparison.OrdinalIgnoreCase);
        Assert.EndsWith("Turn them on again.", PushTestResultDto.Gone, StringComparison.Ordinal);

        // Refused, the device is still subscribed: off, then on, is what replaces its subscription.
        Assert.EndsWith("Turn notifications off and on again.", PushTestResultDto.Rejected, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("webhook-secret-value")]
    [InlineData("Bearer webhook-secret-value")]
    public async Task Webhook_WithTheSecret_WakesTheJobForTheRequestSeerrNames(string authorization)
    {
        var result = await Webhook(authorization, "{\"notification_type\":\"MEDIA_AVAILABLE\",\"subject\":\"Dune\",\"request\":{\"request_id\":\"12\",\"requestedBy_username\":\"alice\"}}");

        Assert.IsType<NoContentResult>(result);
        Assert.True(_signal.Work.TryRead(out var work));
        Assert.Equal(new ReadyPushWork(null, 12), work);
    }

    [Theory]
    [InlineData("{\"notification_type\":\"MEDIA_AVAILABLE\"}")]
    [InlineData("{\"notification_type\":\"MEDIA_AVAILABLE\",\"request\":null}")]
    [InlineData("{\"notification_type\":\"MEDIA_AVAILABLE\",\"request\":{\"request_id\":\"\"}}")]
    [InlineData("{\"notification_type\":\"MEDIA_AVAILABLE\",\"request\":{\"request_id\":\"-3\"}}")]
    public async Task Webhook_WithoutARequestId_StillHasLumenLook(string body)
    {
        Assert.IsType<NoContentResult>(await Webhook("webhook-secret-value", body));

        Assert.True(_signal.Work.TryRead(out var work));
        Assert.Equal(new ReadyPushWork(null, null), work);
    }

    [Theory]
    [InlineData("{\"notification_type\":\"TEST_NOTIFICATION\"}")]
    [InlineData("{\"notification_type\":\"MEDIA_PENDING\",\"request\":{\"request_id\":\"12\"}}")]
    [InlineData("{}")]
    [InlineData("[]")]
    public async Task Webhook_ForAnythingElse_AnswersFine_AndDoesNothing(string body)
    {
        Assert.IsType<NoContentResult>(await Webhook("webhook-secret-value", body));

        Assert.False(_signal.Work.TryRead(out _));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("wrong")]
    [InlineData("Bearer wrong")]
    [InlineData("webhook-secret-valu")]
    [InlineData("MediaBrowser Token=\"webhook-secret-value\"")]
    public async Task Webhook_WithoutTheSecret_IsRefused(string? authorization)
    {
        Assert.IsType<UnauthorizedResult>(await Webhook(authorization, "{\"notification_type\":\"MEDIA_AVAILABLE\",\"request\":{\"request_id\":\"12\"}}"));

        Assert.False(_signal.Work.TryRead(out _));
    }

    [Fact]
    public async Task Webhook_BeforeAnySecretExists_IsRefused()
    {
        _config.Current.Returns(new PluginConfiguration());

        Assert.IsType<UnauthorizedResult>(await Webhook(string.Empty, "{}"));
        Assert.IsType<UnauthorizedResult>(await Webhook("Bearer ", "{}"));
    }

    [Fact]
    public async Task Webhook_WithABodyThatIsntJson_IsABadRequest()
    {
        Assert.IsType<BadRequestResult>(await Webhook("webhook-secret-value", "notification_type=MEDIA_AVAILABLE"));

        Assert.False(_signal.Work.TryRead(out _));
    }

    [Fact]
    public async Task Webhook_WithABodyOverTheLimit_IsTooLarge_NotAServerError()
    {
        const string Start = "{\"notification_type\":\"MEDIA_AVAILABLE\",\"request\":{\"request_id\":\"12\"},\"message\":\"";
        string Padded(int length) => Start + new string('x', length - Start.Length - 2) + "\"}";

        // One byte over, without a Content-Length (a chunked body): found while reading.
        var tooLarge = Assert.IsType<StatusCodeResult>(await Webhook("webhook-secret-value", Padded((64 * 1024) + 1)));
        Assert.Equal(StatusCodes.Status413PayloadTooLarge, tooLarge.StatusCode);
        Assert.False(_signal.Work.TryRead(out _));

        // The largest body taken is read and acted on.
        Assert.IsType<NoContentResult>(await Webhook("webhook-secret-value", Padded(64 * 1024)));
        Assert.True(_signal.Work.TryRead(out var work));
        Assert.Equal(new ReadyPushWork(null, 12), work);
    }

    [Fact]
    public async Task Webhook_SayingItsBodyIsOverTheLimit_IsTooLarge_WithoutReadingIt()
    {
        var controller = Create(null, null);
        controller.Request.Headers.Authorization = "webhook-secret-value";
        controller.Request.ContentLength = (64 * 1024) + 1;
        controller.Request.Body = new ThrowingStream(new InvalidOperationException("the body must not be read"));

        Assert.Equal(StatusCodes.Status413PayloadTooLarge, Assert.IsType<StatusCodeResult>(await controller.SeerrWebhook(CancellationToken.None)).StatusCode);
    }

    [Fact]
    public async Task Webhook_WhenTheServersOwnLimitStopsTheBody_IsTooLarge_NotAServerError()
    {
        // What Kestrel throws from the body's stream once [RequestSizeLimit] is passed.
        var controller = Create(null, null);
        controller.Request.Headers.Authorization = "webhook-secret-value";
        controller.Request.Body = new ThrowingStream(new BadHttpRequestException("Request body too large.", StatusCodes.Status413PayloadTooLarge));

        Assert.Equal(StatusCodes.Status413PayloadTooLarge, Assert.IsType<StatusCodeResult>(await controller.SeerrWebhook(CancellationToken.None)).StatusCode);

        // And that limit is still on the action: an oversized body is cut off by the server, not buffered by Lumen.
        Assert.Single(typeof(PushController).GetMethod(nameof(PushController.SeerrWebhook))!.GetCustomAttributes(typeof(RequestSizeLimitAttribute), false));
    }

    [Fact]
    public async Task Webhook_WithABodyOverTheLimit_ButNotTheSecret_IsStillJustRefused()
    {
        var controller = Create(null, null);
        controller.Request.Headers.Authorization = "wrong";
        controller.Request.ContentLength = 10_000_000;
        controller.Request.Body = new ThrowingStream(new InvalidOperationException("the body must not be read"));

        Assert.IsType<UnauthorizedResult>(await controller.SeerrWebhook(CancellationToken.None));
    }

    [Fact]
    public async Task Webhook_WhenTheQueueIsFull_SaysSo_ForSeerrToCallAgain_AndLogsItOnce()
    {
        const string Available = "{\"notification_type\":\"MEDIA_AVAILABLE\",\"request\":{\"request_id\":\"12\"}}";
        for (var i = 0; i < ReadyPushSignal.MaxQueued; i++)
        {
            Assert.IsType<NoContentResult>(await Webhook("webhook-secret-value", Available));
        }

        // No room: 503 with when to try again, never a 204 for something that was dropped.
        for (var i = 0; i < 3; i++)
        {
            var controller = Create(null, null);
            controller.Request.Headers.Authorization = "webhook-secret-value";
            controller.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(Available));
            var full = Assert.IsType<StatusCodeResult>(await controller.SeerrWebhook(CancellationToken.None));
            Assert.Equal(StatusCodes.Status503ServiceUnavailable, full.StatusCode);
            Assert.Equal("30", controller.Response.Headers.RetryAfter.ToString());
        }

        Assert.Single(_signalLog.Entries, e => e.Level == Microsoft.Extensions.Logging.LogLevel.Warning);

        // Anything Lumen wouldn't act on anyway is still fine.
        Assert.IsType<NoContentResult>(await Webhook("webhook-secret-value", "{\"notification_type\":\"TEST_NOTIFICATION\"}"));

        // The job caught up: taken again, and the next time it's full is logged again.
        var queued = 0;
        while (_signal.Work.TryRead(out _))
        {
            queued++;
        }

        Assert.Equal(ReadyPushSignal.MaxQueued, queued);
        for (var i = 0; i < ReadyPushSignal.MaxQueued; i++)
        {
            Assert.IsType<NoContentResult>(await Webhook("webhook-secret-value", Available));
        }

        Assert.IsType<StatusCodeResult>(await Webhook("webhook-secret-value", Available));
        Assert.Equal(2, _signalLog.Entries.Count(e => e.Level == Microsoft.Extensions.Logging.LogLevel.Warning));
    }

    private Task<ActionResult> Webhook(string? authorization, string body)
    {
        var controller = Create(null, null);
        if (authorization is not null)
        {
            controller.Request.Headers.Authorization = authorization;
        }

        controller.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));
        return controller.SeerrWebhook(CancellationToken.None);
    }

    private PushSubscribeDto Body(string? endpoint = Apple) => new(endpoint, _p256dh, _auth);

    /// <summary>
    /// A request as Jellyfin authenticates it: signed in as <paramref name="user"/> with the token issued to
    /// <paramref name="deviceId"/> (or <paramref name="token"/>, one Jellyfin's device list doesn't have). Its device
    /// id claim is what the request's own header says: the same device, unless <paramref name="claims"/> another.
    /// </summary>
    private PushController Create(Guid? user, string? deviceId, string? deviceName = null, string? claims = null, string? token = null)
    {
        var list = new List<Claim>();
        if (user is { } id)
        {
            list.Add(new Claim("Jellyfin-UserId", id.ToString("N")));
        }

        if (user is { } owner && deviceId is not null)
        {
            token = "token-" + owner.ToString("N") + "-" + deviceId;
            _tokens[token] = (owner, new SessionDevice(deviceId, deviceName));
        }

        if (token is not null)
        {
            list.Add(new Claim("Jellyfin-Token", token));
        }

        if ((claims ?? deviceId) is { } claimed)
        {
            list.Add(new Claim("Jellyfin-DeviceId", claimed));
        }

        if (deviceName is not null)
        {
            list.Add(new Claim("Jellyfin-Device", deviceName));
        }

        var assets = new AssetCatalog(new Dictionary<string, byte[]> { [PushController.WorkerAsset] = Encoding.UTF8.GetBytes("self.addEventListener('push', function () {});") });
        return new PushController(assets, _users, _config, _store, _sender, _limiter, _subscribeLimiter, _devices, _signal, _time, NullLogger<PushController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(list, "test")) } },
        };
    }

    /// <summary>A request body that can't be read.</summary>
    private sealed class ThrowingStream(Exception error) : MemoryStream
    {
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => throw error;

        public override int Read(byte[] buffer, int offset, int count) => throw error;
    }
}
