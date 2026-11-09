namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Upgrades stored configuration to <see cref="PluginConfiguration.CurrentSchemaVersion"/>. Pure.</summary>
public static class ConfigMigrator
{
    /// <summary>Applies every pending schema migration in order.</summary>
    /// <returns>True when the configuration was changed and must be saved.</returns>
    public static bool Migrate(PluginConfiguration config, IReadOnlyList<LibraryInfo> libraries)
    {
        var changed = false;

        if (config.SchemaVersion < 1)
        {
            if (config.Sections.Count == 0)
            {
                config.Sections = DefaultSections.Create(libraries);
            }

            config.SchemaVersion = 1;
            changed = true;
        }

        if (config.SchemaVersion < 2)
        {
            // The default red changed with the refined J; a server still on the old default follows it, a custom accent stays.
            if (string.Equals(config.AccentColor, PluginConfiguration.LegacyDefaultAccent, StringComparison.OrdinalIgnoreCase))
            {
                config.AccentColor = PluginConfiguration.DefaultAccent;
            }

            config.SchemaVersion = 2;
            changed = true;
        }

        // Future migrations: `if (config.SchemaVersion < 3) { ...; config.SchemaVersion = 3; changed = true; }`
        return changed;
    }
}
