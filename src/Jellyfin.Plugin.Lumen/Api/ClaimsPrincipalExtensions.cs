using System.Security.Claims;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Reads Jellyfin's user id claim (Jellyfin.Api's helper is not available to plugins).</summary>
public static class ClaimsPrincipalExtensions
{
    private const string UserIdClaim = "Jellyfin-UserId";

    public static Guid? GetJellyfinUserId(this ClaimsPrincipal principal)
    {
        var value = principal.Claims.FirstOrDefault(c => string.Equals(c.Type, UserIdClaim, StringComparison.OrdinalIgnoreCase))?.Value;
        return Guid.TryParse(value, out var id) && id != Guid.Empty ? id : null;
    }
}
