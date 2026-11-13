using System.Buffers.Text;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Push;
using Jellyfin.Plugin.Lumen.Tests.Requests;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Push;

public sealed class WebPushClientTests : IDisposable
{
    private readonly FakeHttp _http = new();
    private readonly ILumenConfigStore _config = Substitute.For<ILumenConfigStore>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly VapidKeys _keys = VapidKeys.Generate();
    private readonly ECDiffieHellman _browser = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    private readonly byte[] _auth = RandomNumberGenerator.GetBytes(16);
    private readonly WebPushClient _client;

    public WebPushClientTests()
    {
        _config.GetPushSecrets().Returns(new PushSecrets(_keys, "hook"));
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.Created);
        _client = new WebPushClient(_http.Factory, _config, _time);
    }

    public void Dispose()
    {
        _browser.Dispose();
        _http.Dispose();
    }

    [Fact]
    public async Task Send_PostsTheMessageEncryptedForThatBrowser_SignedAsThisServer()
    {
        byte[]? body = null;
        _http.Respond = request =>
        {
            body = request.Content!.ReadAsByteArrayAsync().GetAwaiter().GetResult();
            return new HttpResponseMessage(HttpStatusCode.Created);
        };
        var payload = Encoding.UTF8.GetBytes("{\"title\":\"Dune is ready to watch\"}");

        var result = await _client.SendAsync(Subscription("https://web.push.apple.com/QGdevice"), payload, TimeSpan.FromDays(3), CancellationToken.None);

        Assert.Equal(new PushResult(PushOutcome.Sent, 201), result);
        var request = Assert.Single(_http.Requests);
        Assert.Equal((HttpMethod.Post, "https://web.push.apple.com/QGdevice"), (request.Method, request.RequestUri!.ToString()));
        Assert.Equal("aes128gcm", Assert.Single(request.Content!.Headers.ContentEncoding));
        Assert.Equal("259200", Assert.Single(request.Headers.GetValues("TTL")));
        Assert.Equal("normal", Assert.Single(request.Headers.GetValues("Urgency")));

        // Only the browser can read it: not the title in the clear, anywhere in what the push service sees.
        Assert.DoesNotContain("Dune", Encoding.Latin1.GetString(body!), StringComparison.Ordinal);
        Assert.Equal(payload, WebPushEncryptionTests.Decrypt(body!, _browser, _auth));

        // RFC 8292: vapid t=<ES256 JWT for the push service's origin>, k=<this server's public key>.
        var authorization = Assert.Single(request.Headers.GetValues("Authorization"));
        Assert.EndsWith(", k=" + _keys.PublicKey, authorization, StringComparison.Ordinal);
        var token = authorization["vapid t=".Length..authorization.IndexOf(',', StringComparison.Ordinal)].Split('.');
        using var claims = JsonDocument.Parse(Base64Url.DecodeFromChars(token[1]));
        Assert.Equal("https://web.push.apple.com", claims.RootElement.GetProperty("aud").GetString());
        Assert.Equal(WebPushClient.Subject, claims.RootElement.GetProperty("sub").GetString());
        Assert.InRange(claims.RootElement.GetProperty("exp").GetInt64(), TestData.Now.ToUnixTimeSeconds() + 60, TestData.Now.ToUnixTimeSeconds() + 86400);
        using var verifier = ECDsa.Create(WebPushEncryption.ImportPublicKey(Base64Url.DecodeFromChars(_keys.PublicKey)));
        Assert.True(verifier.VerifyData(Encoding.ASCII.GetBytes(token[0] + "." + token[1]), Base64Url.DecodeFromChars(token[2]), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));

        // Nothing of the private key, the browser's keys or the user in any header.
        var headers = string.Join('\n', request.Headers.Concat(request.Content.Headers).SelectMany(h => h.Value));
        Assert.DoesNotContain(_keys.PrivateKey, headers, StringComparison.Ordinal);
        Assert.DoesNotContain(Base64Url.EncodeToString(_auth), headers, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(HttpStatusCode.Created, PushOutcome.Sent)]
    [InlineData(HttpStatusCode.OK, PushOutcome.Sent)]
    [InlineData(HttpStatusCode.NotFound, PushOutcome.Gone)]
    [InlineData(HttpStatusCode.Gone, PushOutcome.Gone)]
    [InlineData(HttpStatusCode.BadRequest, PushOutcome.Rejected)]
    [InlineData(HttpStatusCode.Forbidden, PushOutcome.Rejected)]
    [InlineData(HttpStatusCode.RequestEntityTooLarge, PushOutcome.Rejected)]
    [InlineData(HttpStatusCode.TooManyRequests, PushOutcome.Failed)]
    [InlineData(HttpStatusCode.InternalServerError, PushOutcome.Failed)]
    [InlineData(HttpStatusCode.BadGateway, PushOutcome.Failed)]
    [InlineData(HttpStatusCode.MovedPermanently, PushOutcome.Failed)] // a redirect is never followed
    public async Task Send_ReadsThePushServicesAnswer(HttpStatusCode status, PushOutcome outcome)
    {
        _http.Respond = _ => new HttpResponseMessage(status);

        var result = await _client.SendAsync(Subscription("https://fcm.googleapis.com/fcm/send/x"), new byte[] { 1 }, TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.Equal(new PushResult(outcome, (int)status), result);
    }

    [Fact]
    public async Task Send_AnUnreachablePushService_IsAFailure_NotAnException()
    {
        _http.Respond = _ => throw new HttpRequestException("no route");

        var result = await _client.SendAsync(Subscription("https://fcm.googleapis.com/fcm/send/x"), new byte[] { 1 }, TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.Equal(new PushResult(PushOutcome.Failed), result);
    }

    [Fact]
    public async Task Send_ToKeysNoBrowserSent_IsGone_WithoutCallingAnyone()
    {
        var broken = Subscription("https://fcm.googleapis.com/fcm/send/x") with { P256dh = "AAAA" };

        var result = await _client.SendAsync(broken, new byte[] { 1 }, TimeSpan.FromMinutes(1), CancellationToken.None);

        Assert.Equal(PushOutcome.Gone, result.Outcome);
        Assert.Empty(_http.Requests);
    }

    private PushSubscription Subscription(string endpoint) =>
        new(endpoint, Base64Url.EncodeToString(WebPushEncryption.ExportPublicKey(_browser)), Base64Url.EncodeToString(_auth), "device", "Device", null, TestData.Now);
}
