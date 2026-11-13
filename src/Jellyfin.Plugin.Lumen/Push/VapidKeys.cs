using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>
/// This server's identity towards push services (RFC 8292, VAPID): a P-256 key pair. Browsers subscribe with the public
/// key (<c>applicationServerKey</c>), and a push service then only takes messages signed with the private one, so a
/// leaked subscription address alone can't be used to send. Both are base64url, as the Push API and the
/// <c>Authorization</c> header carry them: the public key as an uncompressed point (65 bytes), the private key as its
/// scalar (32 bytes).
/// </summary>
public sealed record VapidKeys(string PublicKey, string PrivateKey)
{
    /// <summary>How long a token is good for. Push services take at most 24 hours (RFC 8292 §2).</summary>
    public static readonly TimeSpan TokenLifetime = TimeSpan.FromHours(12);

    public static VapidKeys Generate()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var parameters = key.ExportParameters(true);
        try
        {
            return new VapidKeys(Base64Url.EncodeToString(WebPushEncryption.ToPoint(parameters.Q)), Base64Url.EncodeToString(parameters.D));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(parameters.D);
        }
    }

    /// <summary>Whether both keys are there and decode to a P-256 pair (a config edited by hand may not).</summary>
    public static bool IsValid(string? publicKey, string? privateKey)
    {
        if (string.IsNullOrEmpty(publicKey) || string.IsNullOrEmpty(privateKey))
        {
            return false;
        }

        try
        {
            using var key = new VapidKeys(publicKey, privateKey).ImportPrivateKey();
            return true;
        }
        catch (Exception e) when (e is FormatException or CryptographicException or ArgumentException)
        {
            return false;
        }
    }

    /// <summary>
    /// The <c>Authorization</c> header for a push to <paramref name="endpoint"/>: <c>vapid t=&lt;JWT&gt;, k=&lt;public key&gt;</c>
    /// (RFC 8292 §3). The JWT is signed with ES256 and says who it's for (<c>aud</c>: the push service's origin), until
    /// when (<c>exp</c>) and whom to contact (<c>sub</c>).
    /// </summary>
    public string AuthorizationHeader(Uri endpoint, string subject, DateTimeOffset now) =>
        "vapid t=" + CreateToken(Audience(endpoint), subject, now + TokenLifetime) + ", k=" + PublicKey;

    /// <summary>Never prints the private key.</summary>
    public override string ToString() => "VapidKeys { PublicKey = " + PublicKey + ", PrivateKey = *** }";

    /// <summary>The push service's origin: scheme, host and a port that isn't the scheme's own (RFC 8292 §2).</summary>
    internal static string Audience(Uri endpoint) => endpoint.GetLeftPart(UriPartial.Authority);

    internal string CreateToken(string audience, string subject, DateTimeOffset expires)
    {
        var header = Base64Url.EncodeToString("{\"typ\":\"JWT\",\"alg\":\"ES256\"}"u8);
        var claims = Base64Url.EncodeToString(JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object>
        {
            ["aud"] = audience,
            ["exp"] = expires.ToUnixTimeSeconds(),
            ["sub"] = subject,
        }));
        var signed = header + "." + claims;
        using var key = ImportPrivateKey();

        // JWS wants the signature as R and S side by side (RFC 7518 §3.4), not DER.
        var signature = key.SignData(Encoding.ASCII.GetBytes(signed), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return signed + "." + Base64Url.EncodeToString(signature);
    }

    private ECDsa ImportPrivateKey()
    {
        var point = Base64Url.DecodeFromChars(PublicKey);
        var d = Base64Url.DecodeFromChars(PrivateKey);
        if (point.Length != WebPushEncryption.PublicKeyLength || point[0] != 4 || d.Length != 32)
        {
            throw new CryptographicException("Not a P-256 key pair.");
        }

        var parameters = WebPushEncryption.ImportPublicKey(point);
        parameters.D = d;
        try
        {
            return ECDsa.Create(parameters);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(d);
        }
    }
}
