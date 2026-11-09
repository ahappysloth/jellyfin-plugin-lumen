using Jellyfin.Plugin.Lumen.Requests;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>Who may see catalog rows, and as which Seerr user.</summary>
public sealed class CatalogRowAccess
{
    private readonly ISeerrUserMap _users;

    public CatalogRowAccess(ISeerrUserMap users)
    {
        _users = users;
    }

    /// <summary>The Seerr endpoint and the user's Seerr id, or null when the user has no catalog access.</summary>
    public async Task<(SeerrEndpoint Endpoint, int SeerrUserId)?> GetAsync(Guid jellyfinUserId, CancellationToken cancellationToken)
    {
        var access = await _users.GetAccessAsync(jellyfinUserId, cancellationToken).ConfigureAwait(false);
        return access.Enabled && access.SeerrUserId is { } seerrUserId && access.Endpoint is { } endpoint
            ? (endpoint, seerrUserId)
            : null;
    }
}
