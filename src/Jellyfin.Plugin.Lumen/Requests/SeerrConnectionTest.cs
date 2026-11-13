using System.Net;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>What <see cref="SeerrConnectionTest"/> found.</summary>
/// <param name="Version">Seerr's version, when it answered.</param>
/// <param name="Error">Why it failed (null when it worked).</param>
/// <param name="Status">The HTTP status of a failure Seerr answered with (401 or 403: the key was refused).</param>
/// <param name="Server">The Jellyfin server Seerr is linked to; null when unknown.</param>
public sealed record SeerrConnectionResult(string? Version, string? Error, HttpStatusCode? Status, SeerrJellyfinServer? Server)
{
    public bool Ok => Error is null;

    public bool KeyRejected => Status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden;
}

/// <summary>
/// Settings → Requests' Test connection, and the Health tab's Seerr row: Seerr answers, its key works, and which Jellyfin
/// server it's linked to.
/// </summary>
public static class SeerrConnectionTest
{
    /// <summary>
    /// The longest a test takes: two rounds of calls, each cut off at <see cref="SeerrClient.Timeout"/>, and a moment over,
    /// so a slow Seerr still fails with its own message.
    /// </summary>
    public static readonly TimeSpan TimeLimit = (SeerrClient.Timeout * 2) + TimeSpan.FromSeconds(1);

    public static async Task<SeerrConnectionResult> RunAsync(ISeerrClient seerr, SeerrEndpoint endpoint, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(seerr);
        try
        {
            var status = await seerr.GetStatusAsync(endpoint, cancellationToken).ConfigureAwait(false);

            // /status answers without a key, so prove the key works with a call that needs it. Admin lookups bypass the
            // circuit breaker, so this really tries even right after an outage, and a failure here pauses nothing. The
            // linked server is asked at the same time (it needs the key too, and fails quietly without it), so a slow
            // Seerr costs two of its timeouts at most, not three.
            var key = seerr.GetUserByJellyfinIdForAdminAsync(endpoint, Guid.Empty, cancellationToken);
            var server = TryGetJellyfinServerAsync(seerr, endpoint, cancellationToken);
            await Task.WhenAll(key, server).ConfigureAwait(false);
            return new SeerrConnectionResult(status.Version, null, null, await server.ConfigureAwait(false));
        }
        catch (SeerrException e)
        {
            return new SeerrConnectionResult(null, e.Message, e.Status, null);
        }
    }

    /// <summary>Seerr's linked Jellyfin server; null if Seerr uses Plex/Emby, or the settings can't be read.</summary>
    public static async Task<SeerrJellyfinServer?> TryGetJellyfinServerAsync(ISeerrClient seerr, SeerrEndpoint endpoint, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(seerr);
        try
        {
            return await seerr.GetJellyfinServerAsync(endpoint, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException)
        {
            return null;
        }
    }
}
