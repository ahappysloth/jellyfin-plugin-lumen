namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Seerr's MediaRequestStatus values (a request's own state, not the title's availability).</summary>
public static class SeerrRequestStatus
{
    /// <summary>Waiting for an admin's approval.</summary>
    public const int Pending = 1;

    public const int Approved = 2;

    public const int Declined = 3;
}
