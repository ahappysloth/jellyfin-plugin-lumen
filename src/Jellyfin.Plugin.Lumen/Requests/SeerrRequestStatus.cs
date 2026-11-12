namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Seerr's MediaRequestStatus values (a request's own state, not the title's availability).</summary>
public static class SeerrRequestStatus
{
    /// <summary>Waiting for an admin's approval.</summary>
    public const int Pending = 1;

    public const int Approved = 2;

    public const int Declined = 3;

    /// <summary>Sonarr or Radarr refused it (Seerr couldn't add the title).</summary>
    public const int Failed = 4;

    /// <summary>Everything requested is available (Seerr marks this when the media server has it).</summary>
    public const int Completed = 5;
}
