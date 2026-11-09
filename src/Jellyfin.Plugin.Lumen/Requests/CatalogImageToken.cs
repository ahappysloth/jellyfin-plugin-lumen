using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>
/// A per-user credential for catalog artwork. <c>&lt;img&gt;</c> can't send headers, so the image URL needs a credential
/// in its query; this one only opens TMDB artwork, unlike the Jellyfin access token it replaces, so a URL that ends up
/// in a log or the browser history can't be used for anything else. It is <c>&lt;user id&gt;.&lt;HMAC&gt;</c>, keyed with
/// the Seerr API key: changing the key (or switching requests off) invalidates every token.
/// </summary>
public static class CatalogImageToken
{
    public static string Create(Guid userId, string secret)
    {
        var id = userId.ToString("N", CultureInfo.InvariantCulture);
        return id + "." + Sign(id, secret);
    }

    /// <summary>The user id a token claims, unverified (to look up that user's access and secret).</summary>
    public static bool TryReadUser(string? token, out Guid userId)
    {
        userId = Guid.Empty;
        var dot = token?.IndexOf('.', StringComparison.Ordinal) ?? -1;
        return dot == 32 && Guid.TryParseExact(token![..dot], "N", out userId) && userId != Guid.Empty;
    }

    public static bool IsValid([NotNullWhen(true)] string? token, Guid userId, string secret) =>
        token is not null
        && CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(token),
            Encoding.ASCII.GetBytes(Create(userId, secret)));

    private static string Sign(string id, string secret)
    {
        var mac = HMACSHA256.HashData(Encoding.UTF8.GetBytes("lumen-catalog-image:" + secret), Encoding.ASCII.GetBytes(id));
        return Convert.ToBase64String(mac, 0, 16).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
