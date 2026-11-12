using System.Globalization;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>One rendered row on the home screen (domain items; mapped to DTOs by the home service).</summary>
public sealed record HomeRow(string Id, string Type, string Title, IReadOnlyList<BaseItem> Items)
{
    /// <summary>A <see cref="Source"/>: the titles are Seerr's (its trending list), not Trakt's.</summary>
    public const string SeerrSource = "Seerr";

    /// <summary>
    /// Gets, for row items without art of their own (genre tiles), the item whose backdrop the card should borrow,
    /// keyed by row item id. Mapped to <c>ParentBackdropItemId</c>/<c>ParentBackdropImageTags</c>.
    /// </summary>
    public IReadOnlyDictionary<Guid, BaseItem>? BackdropSources { get; init; }

    /// <summary>
    /// Gets, for catalog rows, the ordered cards mixing library items and catalog titles. Such rows have empty
    /// <see cref="Items"/>; other rows leave this null.
    /// </summary>
    public IReadOnlyList<HomeRowEntry>? Entries { get; init; }

    /// <summary>
    /// Gets where a row's titles came from when that isn't what its type says: <see cref="SeerrSource"/> for a Top 10 row
    /// showing Seerr's trending list because Trakt has none to give, which has no Top chart to "See all" of. Null otherwise.
    /// </summary>
    public string? Source { get; init; }

    /// <summary>Gets a value indicating whether the row has anything to show.</summary>
    public bool HasContent => Items.Count > 0 || Entries is { Count: > 0 };

    public static string RowId(SectionDefinition definition, int index) =>
        string.Create(CultureInfo.InvariantCulture, $"{definition.Id:N}:{index}");

    /// <summary>Returns a one-row list, or an empty list when there are no items.</summary>
    public static IReadOnlyList<HomeRow> Single(SectionDefinition definition, string defaultTitle, IReadOnlyList<BaseItem> items) =>
        items.Count == 0
            ? []
            : [new HomeRow(RowId(definition, 0), definition.Type, definition.Title ?? defaultTitle, items)];

    /// <summary>Returns a one-row catalog list (<see cref="Entries"/> set), or an empty list when there are no entries.</summary>
    public static IReadOnlyList<HomeRow> Catalog(SectionDefinition definition, string defaultTitle, IReadOnlyList<HomeRowEntry> entries) =>
        entries.Count == 0
            ? []
            : [new HomeRow(RowId(definition, 0), definition.Type, definition.Title ?? defaultTitle, []) { Entries = entries }];
}

/// <summary>One card of a catalog row: a library item (plays like any other card) or a catalog title.</summary>
public sealed record HomeRowEntry(BaseItem? Item, CatalogItemDto? Catalog)
{
    public static HomeRowEntry ForItem(BaseItem item) => new(item, null);

    public static HomeRowEntry ForCatalog(CatalogItemDto catalog) => new(null, catalog);
}
