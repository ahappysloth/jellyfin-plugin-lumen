namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Request states of a catalog title or season (see <see cref="CatalogMapper.MapStatus"/>).</summary>
public static class CatalogState
{
    public const string None = "None";
    public const string Requested = "Requested";
    public const string Downloading = "Downloading";
    public const string PartlyAvailable = "PartlyAvailable";
    public const string Available = "Available";
    public const string Blocklisted = "Blocklisted";
}
