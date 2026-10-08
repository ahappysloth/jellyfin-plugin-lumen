using System.Diagnostics.CodeAnalysis;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Where the home hero banner takes its items from.</summary>
public enum HeroSource
{
    RecentlyAdded,
    TopRatedUnplayed,
    Collection,
}

/// <summary>Lumen settings, persisted by Jellyfin as XML.</summary>
public class PluginConfiguration : BasePluginConfiguration
{
    public const int CurrentSchemaVersion = 1;

    /// <summary>Gets or sets the stored schema version; 0 means "never migrated".</summary>
    public int SchemaVersion { get; set; }

    /// <summary>Gets or sets a counter bumped on every save; used as a cache key.</summary>
    public int ConfigVersion { get; set; }

    public bool Enabled { get; set; } = true;

    public bool HomeTakeover { get; set; } = true;

    public bool DetailsTakeover { get; set; } = true;

    public string AccentColor { get; set; } = "#f5a524";

    public HeroSource HeroSource { get; set; } = HeroSource.RecentlyAdded;

    public Guid? HeroCollectionId { get; set; }

    public int HeroCount { get; set; } = 5;

    public int HeroIntervalSeconds { get; set; } = 8;

    public bool TrailerPreview { get; set; } = true;

    public int TrailerDelaySeconds { get; set; } = 4;

    [SuppressMessage("Usage", "CA2227:Collection properties should be read only", Justification = "XML serialization requires a setter.")]
    [SuppressMessage("Design", "CA1002:Do not expose generic lists", Justification = "XML serialization requires a concrete List.")]
    public List<SectionDefinition> Sections { get; set; } = [];
}
