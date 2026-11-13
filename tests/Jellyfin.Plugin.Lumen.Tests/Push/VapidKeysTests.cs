using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.Lumen.Push;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Push;

public class VapidKeysTests
{
    private static readonly DateTimeOffset Now = TestData.Now;

    [Fact]
    public void Generate_MakesAP256Pair_InThePushApisEncoding()
    {
        var keys = VapidKeys.Generate();

        var point = Base64Url.DecodeFromChars(keys.PublicKey);
        Assert.Equal(65, point.Length);
        Assert.Equal(4, point[0]);
        Assert.Equal(32, Base64Url.DecodeFromChars(keys.PrivateKey).Length);
        Assert.True(VapidKeys.IsValid(keys.PublicKey, keys.PrivateKey));
        Assert.NotEqual(keys, VapidKeys.Generate());
    }

    [Fact]
    public void AuthorizationHeader_CarriesAnEs256Jwt_ThePublicKeyVerifies()
    {
        var keys = VapidKeys.Generate();

        var header = keys.AuthorizationHeader(new Uri("https://web.push.apple.com/QGx3abc"), "https://example.org/contact", Now);

        Assert.StartsWith("vapid t=", header, StringComparison.Ordinal);
        Assert.EndsWith(", k=" + keys.PublicKey, header, StringComparison.Ordinal);
        var token = header["vapid t=".Length..header.IndexOf(',', StringComparison.Ordinal)];
        var parts = token.Split('.');
        Assert.Equal(3, parts.Length);
        Assert.Equal("{\"typ\":\"JWT\",\"alg\":\"ES256\"}", Encoding.UTF8.GetString(Base64Url.DecodeFromChars(parts[0])));

        using var claims = JsonDocument.Parse(Base64Url.DecodeFromChars(parts[1]));
        Assert.Equal("https://web.push.apple.com", claims.RootElement.GetProperty("aud").GetString());
        Assert.Equal("https://example.org/contact", claims.RootElement.GetProperty("sub").GetString());
        Assert.Equal((Now + TimeSpan.FromHours(12)).ToUnixTimeSeconds(), claims.RootElement.GetProperty("exp").GetInt64());

        // What a push service does: verify R|S over "header.claims" with the key from k=.
        using var verifier = ECDsa.Create(WebPushEncryption.ImportPublicKey(Base64Url.DecodeFromChars(keys.PublicKey)));
        var signature = Base64Url.DecodeFromChars(parts[2]);
        Assert.Equal(64, signature.Length);
        Assert.True(verifier.VerifyData(Encoding.ASCII.GetBytes(parts[0] + "." + parts[1]), signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
    }

    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/abc", "https://fcm.googleapis.com")]
    [InlineData("https://updates.push.services.mozilla.com:443/wpush/v2/abc", "https://updates.push.services.mozilla.com")]
    [InlineData("http://host.docker.internal:5055/push/abc", "http://host.docker.internal:5055")]
    public void Audience_IsThePushServicesOrigin(string endpoint, string audience)
    {
        Assert.Equal(audience, VapidKeys.Audience(new Uri(endpoint)));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", "")]
    [InlineData("not base64url!", "x")]
    [InlineData("AAAA", "AAAA")]
    public void IsValid_RejectsWhatIsntAKeyPair(string? publicKey, string? privateKey)
    {
        Assert.False(VapidKeys.IsValid(publicKey, privateKey));
    }

    [Fact]
    public void IsValid_RejectsAPublicKeyOffTheCurve()
    {
        var keys = VapidKeys.Generate();
        var point = Base64Url.DecodeFromChars(keys.PublicKey);
        point[64] ^= 1;

        Assert.False(VapidKeys.IsValid(Base64Url.EncodeToString(point), keys.PrivateKey));
    }

    [Fact]
    public void ToString_NeverPrintsThePrivateKey()
    {
        var keys = VapidKeys.Generate();

        Assert.DoesNotContain(keys.PrivateKey, keys.ToString(), StringComparison.Ordinal);
    }
}
