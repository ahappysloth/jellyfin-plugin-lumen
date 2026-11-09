namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>
/// What the current Jellyfin user can do with the catalog, and the Seerr endpoint their <see cref="SeerrUserId"/> belongs
/// to. Callers must use this <see cref="Endpoint"/> rather than re-reading the config, so a user id from one Seerr is
/// never sent to another one (with its admin key) while the admin is changing the address. Its <c>ToString</c> never
/// prints the API key (see <see cref="SeerrEndpoint.ToString"/>).
/// </summary>
public sealed record RequestAccess(bool Enabled, bool CanRequestMovies, bool CanRequestTv, int? SeerrUserId, SeerrEndpoint? Endpoint = null)
{
    public static readonly RequestAccess None = new(false, false, false, null);
}
