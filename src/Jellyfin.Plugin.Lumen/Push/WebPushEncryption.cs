using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>
/// Encrypts a push message for one browser, as RFC 8291 (Message Encryption for Web Push) says, in RFC 8188's
/// <c>aes128gcm</c> content encoding: only that browser can read it, not the push service that relays it. .NET's own
/// crypto: ECDH on P-256, HKDF-SHA-256 and AES-128-GCM.
/// </summary>
public static class WebPushEncryption
{
    /// <summary>An uncompressed P-256 point: 0x04, X, Y.</summary>
    public const int PublicKeyLength = 65;

    /// <summary>The browser's authentication secret (RFC 8291 §3.2).</summary>
    public const int AuthSecretLength = 16;

    public const int SaltLength = 16;

    /// <summary>
    /// The record size written in the header. Push services take up to 4096 bytes of body (RFC 8030 §7.2), and the whole
    /// message is one record.
    /// </summary>
    public const int RecordSize = 4096;

    /// <summary>The header (salt, record size, key length, the sender's public key), the padding delimiter and the tag.</summary>
    public const int Overhead = SaltLength + 4 + 1 + PublicKeyLength + 1 + TagLength;

    /// <summary>The longest message that fits in one record.</summary>
    public const int MaxPlaintextLength = RecordSize - Overhead;

    private const int TagLength = 16;

    /// <summary>
    /// The body to POST to the push service (<c>Content-Encoding: aes128gcm</c>), with a new sender key and salt per
    /// message. Throws <see cref="CryptographicException"/> when <paramref name="clientPublicKey"/> isn't a point on
    /// P-256, and <see cref="ArgumentException"/> for keys of the wrong length or a message that's too long.
    /// </summary>
    public static byte[] Encrypt(ReadOnlySpan<byte> plaintext, ReadOnlySpan<byte> clientPublicKey, ReadOnlySpan<byte> authSecret)
    {
        using var sender = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        return Encrypt(plaintext, clientPublicKey, authSecret, sender, RandomNumberGenerator.GetBytes(SaltLength));
    }

    /// <summary>For tests (RFC 8291's example needs its sender key and salt): <see cref="Encrypt(ReadOnlySpan{byte}, ReadOnlySpan{byte}, ReadOnlySpan{byte})"/>.</summary>
    internal static byte[] Encrypt(ReadOnlySpan<byte> plaintext, ReadOnlySpan<byte> clientPublicKey, ReadOnlySpan<byte> authSecret, ECDiffieHellman sender, ReadOnlySpan<byte> salt)
    {
        if (clientPublicKey.Length != PublicKeyLength || clientPublicKey[0] != 4)
        {
            throw new ArgumentException("The browser's key must be an uncompressed P-256 point.", nameof(clientPublicKey));
        }

        if (authSecret.Length != AuthSecretLength)
        {
            throw new ArgumentException("The browser's authentication secret must be 16 bytes.", nameof(authSecret));
        }

        if (salt.Length != SaltLength)
        {
            throw new ArgumentException("The salt must be 16 bytes.", nameof(salt));
        }

        if (plaintext.Length > MaxPlaintextLength)
        {
            throw new ArgumentException("The message is too long for one push record.", nameof(plaintext));
        }

        var senderPublic = ExportPublicKey(sender);
        byte[] secret;
        using (var client = ECDiffieHellman.Create(ImportPublicKey(clientPublicKey)))
        {
            secret = sender.DeriveRawSecretAgreement(client.PublicKey);
        }

        // RFC 8291 §3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" 00 ua_public as_public, 32).
        var keyInfo = new byte[14 + (2 * PublicKeyLength)];
        Encoding.ASCII.GetBytes("WebPush: info\0", keyInfo);
        clientPublicKey.CopyTo(keyInfo.AsSpan(14));
        senderPublic.CopyTo(keyInfo.AsSpan(14 + PublicKeyLength));
        Span<byte> ikm = stackalloc byte[32];
        HKDF.DeriveKey(HashAlgorithmName.SHA256, secret, ikm, authSecret, keyInfo);
        CryptographicOperations.ZeroMemory(secret);

        // RFC 8188 §2.2 and §2.3: the content-encryption key and the nonce (of the first, and only, record).
        Span<byte> key = stackalloc byte[16];
        Span<byte> nonce = stackalloc byte[12];
        HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, key, salt, "Content-Encoding: aes128gcm\0"u8);
        HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, nonce, salt, "Content-Encoding: nonce\0"u8);

        // salt (16) | record size (4) | key id length (1) | key id: the sender's public key (65) | ciphertext | tag (16).
        var body = new byte[Overhead + plaintext.Length];
        salt.CopyTo(body);
        BinaryPrimitives.WriteUInt32BigEndian(body.AsSpan(SaltLength), RecordSize);
        body[SaltLength + 4] = PublicKeyLength;
        senderPublic.CopyTo(body.AsSpan(SaltLength + 5));

        // The last (only) record ends with the delimiter 0x02 (RFC 8188 §2), and no padding after it.
        var record = new byte[plaintext.Length + 1];
        plaintext.CopyTo(record);
        record[^1] = 2;
        var header = SaltLength + 5 + PublicKeyLength;
        using var aes = new AesGcm(key, TagLength);
        aes.Encrypt(nonce, record, body.AsSpan(header, record.Length), body.AsSpan(header + record.Length, TagLength));
        CryptographicOperations.ZeroMemory(record);
        return body;
    }

    /// <summary>The key's public point, uncompressed: 0x04, X, Y (what browsers and push services exchange).</summary>
    internal static byte[] ExportPublicKey(ECAlgorithm key)
    {
        var parameters = key.ExportParameters(false);
        return ToPoint(parameters.Q);
    }

    internal static byte[] ToPoint(ECPoint q)
    {
        var point = new byte[PublicKeyLength];
        point[0] = 4;

        // Coordinates are fixed-length on every platform, but a shorter one would still land right-aligned.
        var (x, y) = (q.X!, q.Y!);
        x.CopyTo(point.AsSpan(1 + 32 - x.Length));
        y.CopyTo(point.AsSpan(33 + 32 - y.Length));
        return point;
    }

    /// <summary>
    /// An uncompressed point as key parameters. Whether it's on the curve is checked when a key is made from them
    /// (<c>ECDiffieHellman.Create</c>, <c>ECDsa.Create</c>), which throws <see cref="CryptographicException"/> if not.
    /// </summary>
    internal static ECParameters ImportPublicKey(ReadOnlySpan<byte> point)
    {
        var parameters = new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = point.Slice(1, 32).ToArray(), Y = point.Slice(33, 32).ToArray() },
        };
        parameters.Validate();
        return parameters;
    }
}
