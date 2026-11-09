using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>
/// Default <see cref="ILumenConfigReader"/>: loads the configuration, migrating (and saving) an old schema on first read.
/// <see cref="LumenConfigStore"/> writes through <see cref="Write"/>, under the same lock.
/// </summary>
public sealed class LumenConfigReader : ILumenConfigReader
{
    private readonly Lock _gate = new();
    private readonly IPluginConfigPersistence _persistence;
    private readonly ILibraryCatalog _libraries;
    private readonly ILogger<LumenConfigReader> _logger;

    public LumenConfigReader(IPluginConfigPersistence persistence, ILibraryCatalog libraries, ILogger<LumenConfigReader> logger)
    {
        _persistence = persistence;
        _libraries = libraries;
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

    /// <summary>The server's libraries, for seeding default sections.</summary>
    internal IReadOnlyList<LibraryInfo> GetLibraries() => _libraries.GetLibraries();

    /// <summary>Persists <paramref name="configuration"/> as the current schema with the next <see cref="PluginConfiguration.ConfigVersion"/>.</summary>
    internal void Write(PluginConfiguration configuration)
    {
        lock (_gate)
        {
            configuration.SchemaVersion = PluginConfiguration.CurrentSchemaVersion;
            configuration.ConfigVersion = Current.ConfigVersion + 1;
            _persistence.Save(configuration);
        }
    }
}
