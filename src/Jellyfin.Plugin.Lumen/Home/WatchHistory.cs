using MediaBrowser.Controller.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>A recently played movie or episode. Episodes carry their series' genres.</summary>
public sealed record WatchedEntry(BaseItem Item, Guid? SeriesId, string? SeriesName, IReadOnlyList<string> Genres, DateTime LastPlayed);

/// <summary>The user's recent plays, most recent first.</summary>
public sealed record WatchHistory(IReadOnlyList<WatchedEntry> Entries)
{
    public static WatchHistory Empty { get; } = new([]);
}
