using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Reads the server's libraries (virtual folders).</summary>
public sealed class LibraryCatalog : ILibraryCatalog
{
    private readonly ILibraryManager _libraryManager;

    public LibraryCatalog(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public IReadOnlyList<LibraryInfo> GetLibraries() =>
        _libraryManager.GetVirtualFolders()
            .Select(f => new LibraryInfo(Guid.TryParse(f.ItemId, out var id) ? id : Guid.Empty, f.Name, f.CollectionType?.ToString()))
            .Where(l => l.Id != Guid.Empty)
            .ToList();
}
