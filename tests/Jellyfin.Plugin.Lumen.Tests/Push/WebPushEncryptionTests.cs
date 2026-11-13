using System.Buffers.Binary;
using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using Jellyfin.Plugin.Lumen.Push;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Push;

public class WebPushEncryptionTests
{
    // RFC 8291 §5 and Appendix A: the example message and every value that goes into it.
    private const string Plaintext = "When I grow up, I want to be a watermelon";
    private const string SenderPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    private const string SenderPrivate = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
    private const string ClientPublic = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    private const string ClientPrivate = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
    private const string Salt = "DGv6ra1nlYgDCS1FRnbzlw";
    private const string AuthSecret = "BTBZMqHH6r4Tts7J_aSIgg";
    private const string Body =
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

    [Fact]
    public void Encrypt_MatchesRfc8291sExample()
    {
        using var sender = Key(SenderPublic, SenderPrivate);

        var body = WebPushEncryption.Encrypt(Encoding.UTF8.GetBytes(Plaintext), Base64Url.DecodeFromChars(ClientPublic), Base64Url.DecodeFromChars(AuthSecret), sender, Base64Url.DecodeFromChars(Salt));

        Assert.Equal(Body, Base64Url.EncodeToString(body));
    }

    [Fact]
    public void Encrypt_UsesANewSenderKeyAndSaltPerMessage_AndTheBrowserCanReadIt()
    {
        using var client = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var clientPublic = WebPushEncryption.ExportPublicKey(client);
        var auth = RandomNumberGenerator.GetBytes(16);
        var message = Encoding.UTF8.GetBytes("{\"title\":\"Dune is ready to watch\"}");

        var first = WebPushEncryption.Encrypt(message, clientPublic, auth);
        var second = WebPushEncryption.Encrypt(message, clientPublic, auth);

        Assert.NotEqual(first, second);
        Assert.NotEqual(first.AsSpan(0, 16).ToArray(), second.AsSpan(0, 16).ToArray());
        Assert.NotEqual(first.AsSpan(21, 65).ToArray(), second.AsSpan(21, 65).ToArray());
        Assert.Equal(message, Decrypt(first, client, auth));
        Assert.Equal(message, Decrypt(second, client, auth));
        Assert.Equal(message.Length + WebPushEncryption.Overhead, first.Length);
    }

    [Fact]
    public void Decrypt_ReadsRfc8291sExample()
    {
        // The helper the other tests rely on, checked against the RFC as well.
        using var client = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = WebPushEncryption.ImportPublicKey(Base64Url.DecodeFromChars(ClientPublic)).Q,
            D = Base64Url.DecodeFromChars(ClientPrivate),
        });

        Assert.Equal(Plaintext, Encoding.UTF8.GetString(Decrypt(Base64Url.DecodeFromChars(Body), client, Base64Url.DecodeFromChars(AuthSecret))));
    }

    [Fact]
    public void Encrypt_TakesAMessageThatFillsTheRecord_AndNoLonger()
    {
        using var client = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var clientPublic = WebPushEncryption.ExportPublicKey(client);
        var auth = new byte[16];

        Assert.Equal(4096, WebPushEncryption.Encrypt(new byte[WebPushEncryption.MaxPlaintextLength], clientPublic, auth).Length);
        Assert.Throws<ArgumentException>(() => WebPushEncryption.Encrypt(new byte[WebPushEncryption.MaxPlaintextLength + 1], clientPublic, auth));
    }

    [Fact]
    public void Encrypt_RejectsKeysABrowserWouldNeverSend()
    {
        using var client = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var good = WebPushEncryption.ExportPublicKey(client);
        var offCurve = (byte[])good.Clone();
        offCurve[64] ^= 1;
        var compressed = good.AsSpan(0, 33).ToArray();

        Assert.ThrowsAny<CryptographicException>(() => WebPushEncryption.Encrypt([1], offCurve, new byte[16]));
        Assert.Throws<ArgumentException>(() => WebPushEncryption.Encrypt([1], compressed, new byte[16]));
        Assert.Throws<ArgumentException>(() => WebPushEncryption.Encrypt([1], good, new byte[15]));
    }

    /// <summary>What a browser does with a push message (RFC 8291 §4): the other side of <see cref="WebPushEncryption"/>.</summary>
    internal static byte[] Decrypt(byte[] body, ECDiffieHellman client, byte[] authSecret)
    {
        var salt = body.AsSpan(0, 16);
        Assert.Equal(4096u, BinaryPrimitives.ReadUInt32BigEndian(body.AsSpan(16)));
        Assert.Equal(65, body[20]);
        var senderPublic = body.AsSpan(21, 65);
        using var sender = ECDiffieHellman.Create(WebPushEncryption.ImportPublicKey(senderPublic));
        var secret = client.DeriveRawSecretAgreement(sender.PublicKey);
        var info = Encoding.ASCII.GetBytes("WebPush: info\0").Concat(WebPushEncryption.ExportPublicKey(client)).Concat(senderPublic.ToArray()).ToArray();
        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, secret, 32, authSecret, info);
        var key = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 16, salt.ToArray(), Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0"));
        var nonce = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 12, salt.ToArray(), Encoding.ASCII.GetBytes("Content-Encoding: nonce\0"));
        var cipher = body.AsSpan(86, body.Length - 86 - 16);
        var record = new byte[cipher.Length];
        using var aes = new AesGcm(key, 16);
        aes.Decrypt(nonce, cipher, body.AsSpan(body.Length - 16), record);
        Assert.Equal(2, record[^1]);
        return record[..^1];
    }

    private static ECDiffieHellman Key(string publicKey, string privateKey)
    {
        var parameters = WebPushEncryption.ImportPublicKey(Base64Url.DecodeFromChars(publicKey));
        parameters.D = Base64Url.DecodeFromChars(privateKey);
        return ECDiffieHellman.Create(parameters);
    }
}
