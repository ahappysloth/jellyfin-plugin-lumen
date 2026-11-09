namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>
/// Reads the (migrated) configuration. Services that only read it depend on this rather than
/// <see cref="ILumenConfigStore"/>, which also needs the section providers to validate saves; that keeps providers that
/// read the configuration (through the Seerr user map) out of a dependency cycle.
/// </summary>
public interface ILumenConfigReader
{
    PluginConfiguration Current { get; }
}

/// <summary>Reads (migrated) configuration and saves validated configuration.</summary>
public interface ILumenConfigStore : ILumenConfigReader
{
    ConfigSaveResult Save(PluginConfiguration configuration);

    void ResetToDefaults();
}

/// <summary>Raw load/save of the plugin's XML configuration.</summary>
public interface IPluginConfigPersistence
{
    PluginConfiguration Load();

    void Save(PluginConfiguration configuration);
}

/// <summary>Lists the server's libraries for default-section seeding.</summary>
public interface ILibraryCatalog
{
    IReadOnlyList<LibraryInfo> GetLibraries();
}

/// <summary>Result of a configuration save.</summary>
public sealed record ConfigSaveResult(bool Success, IReadOnlyList<string> Errors);
