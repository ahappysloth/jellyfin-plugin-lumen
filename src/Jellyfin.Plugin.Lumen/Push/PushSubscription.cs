using System.Buffers.Text;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>
/// One browser (or home-screen app) a user turned notifications on in: the push service's address for it and the two
/// keys messages to it are encrypted with (the Push API's <c>PushSubscription</c>). <c>DeviceId</c> is Jellyfin's id for
/// the device that signed in, so each device has one subscription and can only replace or remove its own.
/// </summary>
public sealed record PushSubscription(string Endpoint, string P256dh, string Auth, string DeviceId, string? DeviceName, DateTimeOffset Created)
{
    /// <summary>The longest address taken (Apple's and Mozilla's are around 200 to 300 characters).</summary>
    public const int MaxEndpointLength = 1024;

    public const int MaxDeviceIdLength = 256;

    /// <summary>
    /// Set <c>LUMEN_PUSH_TEST_ENDPOINT</c> to an address prefix that's accepted as a push service too, over http as well
    /// (the E2E tests' stub, which a real server never sets).
    /// </summary>
    public const string TestEndpointVariable = "LUMEN_PUSH_TEST_ENDPOINT";

    /// <summary>
    /// The push services browsers use, by their exact hosts. The server POSTs to whatever address a subscription names,
    /// so only these are taken: a signed-in user can't point it at something on the server's own network, nor at any
    /// other service of the same companies.
    /// <list type="bullet">
    /// <item>Google's FCM (Chrome, Edge on Android, Brave, Opera, Samsung): <c>fcm.googleapis.com</c>, and
    /// <c>jmt17.google.com</c>, FCM's staging host, which Chrome's Canary and Dev channels subscribe at (both in
    /// Chromium's <c>push_messaging_constants.cc</c>).</item>
    /// <item>Mozilla's autopush (Firefox): <c>updates.push.services.mozilla.com</c>.</item>
    /// <item>Apple's (Safari, and Home Screen apps on iOS): <c>web.push.apple.com</c> today.</item>
    /// </list>
    /// </summary>
    private static readonly string[] PushHosts = ["fcm.googleapis.com", "jmt17.google.com", "updates.push.services.mozilla.com", "web.push.apple.com"];

    /// <summary>
    /// The push services that hand out addresses on many hosts, by the domain they're all under: Apple's (its
    /// documentation says to allow every subdomain of <c>push.apple.com</c>) and Microsoft's WNS, which Edge on Windows
    /// subscribes at (<c>wns2-by3p.notify.windows.com</c> and the like, one per data centre).
    /// </summary>
    private static readonly string[] PushDomains = [".push.apple.com", ".notify.windows.com"];

    /// <summary>A dot, slash or backslash written as an escape: a server may read them as path syntax.</summary>
    private static readonly string[] EscapedPathSyntax = ["%2e", "%2f", "%5c"];

    /// <summary>
    /// Whether <paramref name="endpoint"/> is an https address at a known push service, without credentials or a
    /// fragment (or is under <paramref name="testPrefix"/>, see <see cref="TestEndpointVariable"/>).
    /// </summary>
    public static bool IsAllowedEndpoint(string? endpoint, string? testPrefix = null)
    {
        if (string.IsNullOrEmpty(endpoint)
            || endpoint.Length > MaxEndpointLength
            || !Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Fragment))
        {
            return false;
        }

        // The tests' stub. Compared as the address will be requested (".." resolved, the host in lower case), so one
        // written as "…/push/../api" isn't under the prefix; an escaped dot or slash in the path is never taken.
        if (!string.IsNullOrEmpty(testPrefix)
            && Uri.TryCreate(testPrefix, UriKind.Absolute, out var prefix)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
            && uri.AbsoluteUri.StartsWith(prefix.AbsoluteUri, StringComparison.Ordinal)
            && !EscapedPathSyntax.Any(escape => uri.AbsolutePath.Contains(escape, StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        var host = uri.IdnHost;
        return uri.Scheme == Uri.UriSchemeHttps
            && uri.IsDefaultPort
            && (PushHosts.Contains(host, StringComparer.OrdinalIgnoreCase) || PushDomains.Any(domain => host.EndsWith(domain, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>Whether the keys are what the Push API gives: a P-256 point (65 bytes) and a 16-byte secret, base64url.</summary>
    public static bool AreValidKeys(string? p256dh, string? auth)
    {
        if (string.IsNullOrEmpty(p256dh) || string.IsNullOrEmpty(auth) || p256dh.Length > 128 || auth.Length > 64)
        {
            return false;
        }

        try
        {
            var point = Base64Url.DecodeFromChars(p256dh);
            if (point.Length != WebPushEncryption.PublicKeyLength || point[0] != 4 || Base64Url.DecodeFromChars(auth).Length != WebPushEncryption.AuthSecretLength)
            {
                return false;
            }

            // Making the key is what checks the point is on the curve.
            using var key = System.Security.Cryptography.ECDiffieHellman.Create(WebPushEncryption.ImportPublicKey(point));
            return true;
        }
        catch (Exception e) when (e is FormatException or System.Security.Cryptography.CryptographicException)
        {
            return false;
        }
    }

    /// <summary>Never prints the keys.</summary>
    public override string ToString() => "PushSubscription { DeviceId = " + DeviceId + ", Endpoint = " + EndpointHost(Endpoint) + " }";

    /// <summary>The push service's host, for logs and the admin page: the rest of an address is the device's capability.</summary>
    public static string EndpointHost(string endpoint) =>
        Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) ? uri.Host : "?";
}
