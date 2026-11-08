namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>The Seerr permission bits Lumen checks (values from Seerr's <c>server/lib/permissions.ts</c>, v3.5.1).</summary>
[Flags]
public enum SeerrPermissionBits : long
{
    None = 0,
    Admin = 2,
    Request = 32,
    RequestMovie = 262144,
    RequestTv = 524288,
}

/// <summary>Mirrors Seerr's <c>hasPermission(..., { type: 'or' })</c>: admins have everything.</summary>
public static class SeerrPermissions
{
    public static bool HasAny(long value, params SeerrPermissionBits[] permissions) =>
        (value & (long)SeerrPermissionBits.Admin) != 0 || permissions.Any(p => (value & (long)p) != 0);

    /// <summary>Seerr's own check for creating a movie request.</summary>
    public static bool CanRequestMovies(long value) => HasAny(value, SeerrPermissionBits.Request, SeerrPermissionBits.RequestMovie);

    /// <summary>Seerr's own check for creating a TV request.</summary>
    public static bool CanRequestTv(long value) => HasAny(value, SeerrPermissionBits.Request, SeerrPermissionBits.RequestTv);
}
