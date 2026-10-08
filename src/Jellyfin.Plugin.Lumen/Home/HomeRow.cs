using System.Globalization;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>One rendered row on the home screen (domain items; mapped to DTOs by the home service).</summary>
public sealed record HomeRow(string Id, string Type, string Title, IReadOnlyList<BaseItem> Items)
{
    public static string RowId(SectionDefinition definition, int index) =>
        string.Create(CultureInfo.InvariantCulture, $"{definition.Id:N}:{index}");

    /// <summary>Returns a one-row list, or an empty list when there are no items.</summary>
    public static IReadOnlyList<HomeRow> Single(SectionDefinition definition, string defaultTitle, IReadOnlyList<BaseItem> items) =>
        items.Count == 0
            ? []
            : [new HomeRow(RowId(definition, 0), definition.Type, definition.Title ?? defaultTitle, items)];
}
