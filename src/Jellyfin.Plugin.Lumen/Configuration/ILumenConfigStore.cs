namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Reads (migrated) configuration and saves validated configuration.</summary>
public interface ILumenConfigStore
{
    PluginConfiguration Current { get; }

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
