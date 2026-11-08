using System.Globalization;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>One rendered row on the home screen (domain items; mapped to DTOs by the home service).</summary>
public sealed record HomeRow(string Id, string Type, string Title, IReadOnlyList<BaseItem> Items)
{
    /// <summary>
    /// Gets, for row items without art of their own (genre tiles), the item whose backdrop the card should borrow,
    /// keyed by row item id. Mapped to <c>ParentBackdropItemId</c>/<c>ParentBackdropImageTags</c>.
    /// </summary>
    public IReadOnlyDictionary<Guid, BaseItem>? BackdropSources { get; init; }

    public static string RowId(SectionDefinition definition, int index) =>
        string.Create(CultureInfo.InvariantCulture, $"{definition.Id:N}:{index}");

    /// <summary>Returns a one-row list, or an empty list when there are no items.</summary>
    public static IReadOnlyList<HomeRow> Single(SectionDefinition definition, string defaultTitle, IReadOnlyList<BaseItem> items) =>
        items.Count == 0
            ? []
            : [new HomeRow(RowId(definition, 0), definition.Type, definition.Title ?? defaultTitle, items)];
}
