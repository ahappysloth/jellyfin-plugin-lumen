namespace Jellyfin.Plugin.Lumen.Health;

/// <summary>
/// What the Health tab's checks read from Jellyfin itself: a narrow seam over its configuration, plugin manager, library
/// options and media segments, so each check can be tested without a server.
/// </summary>
public interface IJellyfinFacts
{
    /// <summary>Gets Dashboard → Branding → Custom CSS (empty when none).</summary>
    string BrandingCustomCss { get; }

    /// <summary>Gets a value indicating whether Quick Connect is on (Dashboard → General).</summary>
    bool QuickConnectEnabled { get; }

    IReadOnlyList<InstalledPlugin> GetPlugins();

    /// <summary>The media segment providers Jellyfin has (one per plugin that provides segments), by name.</summary>
    IReadOnlyList<string> GetSegmentProviders();

    IReadOnlyList<LibrarySegmentOptions> GetLibraries();

    /// <summary>Counts episodes with intro segments; null when Jellyfin's segment store can't be read.</summary>
    Task<IntroCoverage?> GetIntroCoverageAsync(CancellationToken cancellationToken);
}

/// <summary>An installed plugin, as Jellyfin's plugin manager lists it.</summary>
/// <param name="Name">Its name (Intro Skipper).</param>
/// <param name="Status">Jellyfin's PluginStatus by name: Active, Restart, Disabled, NotSupported, Malfunctioned, Superseded, Deleted.</param>
public sealed record InstalledPlugin(string Name, string Status);

/// <summary>A library and the media segment providers switched off for it (its library options).</summary>
/// <param name="Name">The library's name.</param>
/// <param name="CollectionType">tvshows, movies, … or null for a mixed library.</param>
/// <param name="DisabledSegmentProviders">Providers unticked under "Media segment providers", by name.</param>
public sealed record LibrarySegmentOptions(string Name, string? CollectionType, IReadOnlyList<string> DisabledSegmentProviders);

/// <summary>How many episodes (real ones, not missing or virtual) have an intro segment.</summary>
public sealed record IntroCoverage(int WithIntro, int Episodes);
