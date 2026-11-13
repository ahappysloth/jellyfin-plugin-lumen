using System.Buffers.Text;
using System.Security.Cryptography;
using Jellyfin.Plugin.Lumen.Push;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Push;

public class PushSubscriptionTests
{
    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/abc:def")]
    [InlineData("https://jmt17.google.com/fcm/send/abc")]
    [InlineData("https://web.push.apple.com/QGx3abc")]
    [InlineData("https://updates.push.services.mozilla.com/wpush/v2/gAAAA")]
    [InlineData("https://wns2-by3p.notify.windows.com/w/?token=abc")]
    [InlineData("https://WEB.PUSH.APPLE.COM/QGx3abc")]
    public void KnownPushServices_AreAllowed(string endpoint)
    {
        Assert.True(PushSubscription.IsAllowedEndpoint(endpoint));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not a url")]
    [InlineData("/relative")]
    [InlineData("http://fcm.googleapis.com/fcm/send/abc")] // not https
    [InlineData("https://localhost/push")]
    [InlineData("https://192.168.1.10/push")]
    [InlineData("https://seerr:5055/api/v1/settings")]
    [InlineData("https://example.com/push")]
    [InlineData("https://push.apple.com.evil.example/x")]
    [InlineData("https://evilpush.apple.com/x")] // "push.apple.com" must be a whole label suffix
    [InlineData("https://user:pw@fcm.googleapis.com/fcm/send/abc")]
    [InlineData("https://fcm.googleapis.com:8443/fcm/send/abc")]
    [InlineData("https://fcm.googleapis.com/fcm/send/abc#frag")]
    [InlineData("ftp://fcm.googleapis.com/fcm/send/abc")]
    public void AnythingElse_IsRefused_SoTheServerNeverPostsIntoItsOwnNetwork(string? endpoint)
    {
        Assert.False(PushSubscription.IsAllowedEndpoint(endpoint));
    }

    [Fact]
    public void AnAddressTooLongToBeOne_IsRefused()
    {
        Assert.False(PushSubscription.IsAllowedEndpoint("https://fcm.googleapis.com/" + new string('a', PushSubscription.MaxEndpointLength)));
    }

    [Fact]
    public void TheTestsStub_IsAllowedOnlyWhereItsPrefixIsSet()
    {
        const string Stub = "http://host.docker.internal:5055/push/abc";

        Assert.False(PushSubscription.IsAllowedEndpoint(Stub));
        Assert.True(PushSubscription.IsAllowedEndpoint(Stub, "http://host.docker.internal:5055/push/"));
        Assert.False(PushSubscription.IsAllowedEndpoint("http://host.docker.internal:5055/api/v1/x", "http://host.docker.internal:5055/push/"));
        Assert.False(PushSubscription.IsAllowedEndpoint("file:///etc/passwd", "file:///"));
    }

    [Fact]
    public void KeysMustBeWhatABrowserGives()
    {
        using var key = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var point = WebPushEncryption.ExportPublicKey(key);
        var p256dh = Base64Url.EncodeToString(point);
        var auth = Base64Url.EncodeToString(new byte[16]);
        var offCurve = (byte[])point.Clone();
        offCurve[64] ^= 1;

        Assert.True(PushSubscription.AreValidKeys(p256dh, auth));
        Assert.False(PushSubscription.AreValidKeys(null, auth));
        Assert.False(PushSubscription.AreValidKeys(p256dh, null));
        Assert.False(PushSubscription.AreValidKeys(p256dh, Base64Url.EncodeToString(new byte[15])));
        Assert.False(PushSubscription.AreValidKeys(Base64Url.EncodeToString(point.AsSpan(0, 33)), auth));
        Assert.False(PushSubscription.AreValidKeys(Base64Url.EncodeToString(offCurve), auth));
        Assert.False(PushSubscription.AreValidKeys("***", auth));
        Assert.False(PushSubscription.AreValidKeys(new string('A', 500), auth));
    }
}
