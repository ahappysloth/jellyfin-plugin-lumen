namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>
/// Default <see cref="ILumenConfigStore"/>: migrates on read (via <see cref="LumenConfigReader"/>), validates on save,
/// bumps ConfigVersion. Every save goes through here, including Jellyfin's own plugin-configuration endpoint (see
/// <see cref="LumenPlugin.UpdateConfiguration"/>).
/// </summary>
public sealed class LumenConfigStore : ILumenConfigStore
{
    private readonly LumenConfigReader _reader;
    private readonly ConfigValidator _validator;

    public LumenConfigStore(LumenConfigReader reader, ConfigValidator validator)
    {
        _reader = reader;
        _validator = validator;
    }

    public PluginConfiguration Current => _reader.Current;

    public ConfigSaveResult Save(PluginConfiguration configuration)
    {
        // The admin page never sees the Seerr key, so an empty key on save means "keep the stored one", but only for
        // the same Seerr: a new address needs its key typed again, so the stored key is never sent somewhere new.
        var stored = Current;
        if (string.IsNullOrEmpty(configuration.SeerrApiKey)
            && ConfigValidator.SameSeerr(configuration.SeerrUrl, stored.SeerrUrl))
        {
            configuration.SeerrApiKey = stored.SeerrApiKey;
        }

        // The Trakt key works the same way, except that it isn't tied to an address, so the admin page clears it with an
        // explicit flag rather than by sending an empty key.
        configuration.TraktClientId = configuration.ClearTraktClientId
            ? null
            : string.IsNullOrWhiteSpace(configuration.TraktClientId) ? stored.TraktClientId : configuration.TraktClientId.Trim();
        configuration.ClearTraktClientId = false;
        configuration.QuickConnectAddress = ConfigValidator.NormalizeQuickConnectAddress(configuration.QuickConnectAddress);

        var errors = _validator.Validate(configuration);
        if (errors.Count > 0)
        {
            return new ConfigSaveResult(false, errors);
        }

        _reader.Write(configuration);
        return new ConfigSaveResult(true, []);
    }

    public void ResetToDefaults()
    {
        var fresh = new PluginConfiguration();
        ConfigMigrator.Migrate(fresh, _reader.GetLibraries());
        _reader.Write(fresh);
    }
}
