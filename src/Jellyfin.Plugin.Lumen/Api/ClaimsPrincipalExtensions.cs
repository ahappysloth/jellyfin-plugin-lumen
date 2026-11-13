using System.Security.Claims;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Reads Jellyfin's user id claim (Jellyfin.Api's helper is not available to plugins).</summary>
public static class ClaimsPrincipalExtensions
{
    /// <summary>Jellyfin's <c>InternalClaimTypes.UserId</c>, which plugins can't reference; see <see cref="GetJellyfinUserId(ClaimsPrincipal, ILogger)"/>.</summary>
    internal const string UserIdClaim = "Jellyfin-UserId";

    /// <summary>Jellyfin's <c>InternalClaimTypes.DeviceId</c> and <c>Device</c>: the signed-in device's id and its name.</summary>
    internal const string DeviceIdClaim = "Jellyfin-DeviceId";

    internal const string DeviceNameClaim = "Jellyfin-Device";

    /// <summary>Jellyfin's <c>InternalClaimTypes.Token</c>: the access token the request is signed in with.</summary>
    internal const string TokenClaim = "Jellyfin-Token";

    private static int _warnedMissingClaim;

    /// <summary>
    /// The device id this request names, or null. Jellyfin takes it from the request's <c>Authorization</c> header when
    /// there's one there, so it says which device the caller claims to be, not which one its token was issued to: see
    /// <see cref="Push.ISignedInDevices.ForToken"/> for that.
    /// </summary>
    public static string? GetJellyfinDeviceId(this ClaimsPrincipal principal) => Claim(principal, DeviceIdClaim);

    /// <summary>The access token this request is signed in with, or null.</summary>
    public static string? GetJellyfinToken(this ClaimsPrincipal principal) => Claim(principal, TokenClaim);

    /// <summary>The signed-in device's name ("Safari iOS"), or null.</summary>
    public static string? GetJellyfinDeviceName(this ClaimsPrincipal principal) => Claim(principal, DeviceNameClaim);

    public static Guid? GetJellyfinUserId(this ClaimsPrincipal principal)
    {
        var value = principal.Claims.FirstOrDefault(c => string.Equals(c.Type, UserIdClaim, StringComparison.OrdinalIgnoreCase))?.Value;
        return Guid.TryParse(value, out var id) && id != Guid.Empty ? id : null;
    }

    /// <summary>
    /// <see cref="GetJellyfinUserId(ClaimsPrincipal)"/>, warning once per process when a signed-in request has no user id
    /// claim: then Jellyfin has most likely renamed the claim, and every Lumen user endpoint answers 401.
    /// </summary>
    public static Guid? GetJellyfinUserId(this ClaimsPrincipal principal, ILogger logger)
    {
        var id = principal.GetJellyfinUserId();
        if (id is null
            && principal.Identity?.IsAuthenticated == true
            && !principal.HasClaim(c => string.Equals(c.Type, UserIdClaim, StringComparison.OrdinalIgnoreCase))
            && Interlocked.Exchange(ref _warnedMissingClaim, 1) == 0)
        {
            logger.LogWarning(
                "Lumen found no {Claim} claim on a signed-in request, so it can't tell who the user is and answers 401. This Jellyfin version may have renamed the claim; please report it.",
                UserIdClaim);
        }

        return id;
    }

    private static string? Claim(ClaimsPrincipal principal, string type)
    {
        var value = principal.Claims.FirstOrDefault(c => string.Equals(c.Type, type, StringComparison.OrdinalIgnoreCase))?.Value;
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }
}
