using System.Diagnostics.CodeAnalysis;
using System.Xml.Serialization;
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

    /// <summary>Gets or sets a value indicating whether Lumen replaces the Movies and Shows library pages, Favorites, Search and the settings menu.</summary>
    public bool LibraryTakeover { get; set; } = true;

    public string AccentColor { get; set; } = "#e12d39";

    public HeroSource HeroSource { get; set; } = HeroSource.RecentlyAdded;

    public Guid? HeroCollectionId { get; set; }

    public int HeroCount { get; set; } = 5;

    public int HeroIntervalSeconds { get; set; } = 8;

    public bool TrailerPreview { get; set; } = true;

    public int TrailerDelaySeconds { get; set; } = 4;

    [SuppressMessage("Usage", "CA2227:Collection properties should be read only", Justification = "XML serialization requires a setter.")]
    [SuppressMessage("Design", "CA1002:Do not expose generic lists", Justification = "XML serialization requires a concrete List.")]
    public List<SectionDefinition> Sections { get; set; } = [];

    /// <summary>Gets or sets a value indicating whether catalog browsing and requests via Seerr are on.</summary>
    public bool RequestsEnabled { get; set; }

    /// <summary>Gets or sets Seerr's base URL, e.g. <c>http://seerr:5055</c>.</summary>
    public string? SeerrUrl { get; set; }

    /// <summary>
    /// Gets or sets Seerr's admin API key. Write-only from the admin page: <see cref="WithoutSecrets"/> blanks it, and a
    /// save with a null or empty key keeps the stored one (see LumenConfigStore).
    /// </summary>
    public string? SeerrApiKey { get; set; }

    /// <summary>Gets or sets the TMDB image cache cap, in megabytes.</summary>
    public int ImageCacheMb { get; set; } = 500;

    /// <summary>
    /// Gets or sets a value indicating whether a Seerr API key is stored. Only meaningful on a <see cref="WithoutSecrets"/>
    /// copy, where it replaces the key itself; never persisted, and ignored on save.
    /// </summary>
    [XmlIgnore]
    public bool SeerrApiKeySet { get; set; }

    /// <summary>A copy that is safe to send to the admin page: everything except the Seerr API key.</summary>
    public PluginConfiguration WithoutSecrets()
    {
        var copy = (PluginConfiguration)MemberwiseClone();
        copy.SeerrApiKeySet = !string.IsNullOrEmpty(SeerrApiKey);
        copy.SeerrApiKey = null;
        return copy;
    }
}
