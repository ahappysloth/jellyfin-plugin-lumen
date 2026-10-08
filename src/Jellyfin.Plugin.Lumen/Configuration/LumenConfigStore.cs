using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Default <see cref="ILumenConfigStore"/>: migrates on read, validates on save, bumps ConfigVersion.</summary>
public sealed class LumenConfigStore : ILumenConfigStore
{
    private readonly Lock _gate = new();
    private readonly IPluginConfigPersistence _persistence;
    private readonly ILibraryCatalog _libraries;
    private readonly ConfigValidator _validator;
    private readonly ILogger<LumenConfigStore> _logger;

    public LumenConfigStore(
        IPluginConfigPersistence persistence,
        ILibraryCatalog libraries,
        ConfigValidator validator,
        ILogger<LumenConfigStore> logger)
    {
        _persistence = persistence;
        _libraries = libraries;
        _validator = validator;
        _logger = logger;
    }

    public PluginConfiguration Current
    {
        get
        {
            lock (_gate)
            {
                var config = _persistence.Load();
                if (config.SchemaVersion < PluginConfiguration.CurrentSchemaVersion
                    && ConfigMigrator.Migrate(config, _libraries.GetLibraries()))
                {
                    config.ConfigVersion++;
                    _persistence.Save(config);
                    if (_logger.IsEnabled(LogLevel.Information))
                    {
                        _logger.LogInformation("Lumen configuration migrated to schema {Schema}", config.SchemaVersion);
                    }
                }

                return config;
            }
        }
    }

    public ConfigSaveResult Save(PluginConfiguration configuration)
    {
        var errors = _validator.Validate(configuration);
        if (errors.Count > 0)
        {
            return new ConfigSaveResult(false, errors);
        }

        lock (_gate)
        {
            configuration.SchemaVersion = PluginConfiguration.CurrentSchemaVersion;
            configuration.ConfigVersion = Current.ConfigVersion + 1;
            _persistence.Save(configuration);
        }

        return new ConfigSaveResult(true, []);
    }

    public void ResetToDefaults()
    {
        lock (_gate)
        {
            var fresh = new PluginConfiguration();
            ConfigMigrator.Migrate(fresh, _libraries.GetLibraries());
            fresh.ConfigVersion = Current.ConfigVersion + 1;
            _persistence.Save(fresh);
        }
    }
}
