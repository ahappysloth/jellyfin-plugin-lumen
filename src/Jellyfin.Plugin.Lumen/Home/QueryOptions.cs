using MediaBrowser.Controller.Dto;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>
/// DtoOptions for library queries. The repository uses them to decide which columns and images to load,
/// so items that are displayed, or whose Genres/images are read, must use <see cref="Full"/>.
/// </summary>
public static class QueryOptions
{
    public static DtoOptions Full() => new(true);

    public static DtoOptions IdsOnly() => new(false) { EnableImages = false, EnableUserData = false };
}
