namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>The media types the catalog handles (Seerr's own names).</summary>
public static class CatalogMediaType
{
    public const string Movie = "movie";
    public const string Tv = "tv";

    public static bool IsValid(string? mediaType) => mediaType is Movie or Tv;
}
