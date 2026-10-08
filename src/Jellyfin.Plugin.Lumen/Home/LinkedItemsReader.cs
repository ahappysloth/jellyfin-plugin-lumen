using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Playlists;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Reads collection and playlist contents visible to a user.</summary>
public interface ILinkedItemsReader
{
    CuratedSource? GetCollection(Guid id, User user);

    CuratedSource? GetPlaylist(Guid id, User user);
}

/// <summary>A named, ordered list of items (a collection or playlist).</summary>
public sealed record CuratedSource(string Name, IReadOnlyList<BaseItem> Items);

/// <summary>
/// Thin adapter over Jellyfin entities whose methods use static service locators (not unit-testable); covered by E2E.
/// Null means the source does not exist or the user cannot see it.
/// </summary>
public sealed class LinkedItemsReader : ILinkedItemsReader
{
    private readonly ILibraryManager _libraryManager;

    public LinkedItemsReader(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public CuratedSource? GetCollection(Guid id, User user)
    {
        var collection = _libraryManager.GetItemById<BoxSet>(id, user);
        return collection is null ? null : new CuratedSource(collection.Name, collection.GetChildren(user, true, new InternalItemsQuery(user)).ToList());
    }

    public CuratedSource? GetPlaylist(Guid id, User user)
    {
        var playlist = _libraryManager.GetItemById<Playlist>(id, user);
        if (playlist is null)
        {
            return null;
        }

        var items = playlist.GetManageableItems()
            .Select(t => t.Item2)
            .Where(i => i is not null && i.IsVisible(user))
            .DistinctBy(i => i.Id)
            .ToList();
        return new CuratedSource(playlist.Name, items);
    }
}
