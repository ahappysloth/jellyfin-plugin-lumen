using System.Globalization;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Builds the default section list for a fresh install.</summary>
public static class DefaultSections
{
    public static List<SectionDefinition> Create(IReadOnlyList<LibraryInfo> libraries)
    {
        var sections = new List<SectionDefinition>
        {
            New(SectionTypes.ContinueWatching),
            New(SectionTypes.NextUp),
            New(SectionTypes.BecauseYouWatched, ("maxRows", "2")),
            New(SectionTypes.NewForYou, ("days", "14")),
        };

        var videoLibraries = libraries.Where(IsVideoLibrary).ToList();
        if (videoLibraries.Count == 0)
        {
            sections.Add(New(SectionTypes.RecentlyAdded));
        }
        else
        {
            foreach (var library in videoLibraries)
            {
                var section = New(SectionTypes.RecentlyAdded, ("libraryId", library.Id.ToString("N", CultureInfo.InvariantCulture)));
                section.Title = $"Recently Added in {library.Name}";
                sections.Add(section);
            }
        }

        sections.Add(New(SectionTypes.Genre, ("genreCount", "3")));
        return sections;
    }

    private static bool IsVideoLibrary(LibraryInfo library) =>
        string.Equals(library.CollectionType, "movies", StringComparison.OrdinalIgnoreCase)
        || string.Equals(library.CollectionType, "tvshows", StringComparison.OrdinalIgnoreCase);

    private static SectionDefinition New(string type, params (string Name, string Value)[] parameters) => new()
    {
        Id = Guid.NewGuid(),
        Type = type,
        Enabled = true,
        Params = parameters.Select(p => new SectionParam { Name = p.Name, Value = p.Value }).ToList(),
    };
}
