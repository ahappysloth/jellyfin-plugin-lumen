using System.Buffers.Text;
using System.Security.Cryptography;
using Jellyfin.Plugin.Lumen.Push;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>
/// Default <see cref="ILumenConfigStore"/>: migrates on read (via <see cref="LumenConfigReader"/>), validates on save,
/// bumps ConfigVersion. Every save goes through here, including Jellyfin's own plugin-configuration endpoint (see
/// <see cref="LumenPlugin.UpdateConfiguration"/>).
/// </summary>
public sealed class LumenConfigStore : ILumenConfigStore
{
    /// <summary>One write at a time: a save that started before Web Push's keys were made must not write over them.</summary>
    private readonly Lock _writes = new();
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
        lock (_writes)
        {
            return SaveLocked(configuration);
        }
    }

    public void ResetToDefaults()
    {
        lock (_writes)
        {
            var fresh = new PluginConfiguration();
            ConfigMigrator.Migrate(fresh, _reader.GetLibraries());

            // Settings go back to their defaults; the browsers that subscribed to notifications keep working.
            KeepPushSecrets(fresh, Current);
            _reader.Write(fresh);
        }
    }

    public PushSecrets GetPushSecrets()
    {
        lock (_writes)
        {
            var config = Current;
            return VapidKeys.IsValid(config.VapidPublicKey, config.VapidPrivateKey) && !string.IsNullOrEmpty(config.PushWebhookSecret)
                ? new PushSecrets(new VapidKeys(config.VapidPublicKey!, config.VapidPrivateKey!), config.PushWebhookSecret)
                : WritePushSecrets(config);
        }
    }

    public PushSecrets ResetPushSecrets()
    {
        lock (_writes)
        {
            return WritePushSecrets(Current);
        }
    }

    private static void KeepPushSecrets(PluginConfiguration configuration, PluginConfiguration stored)
    {
        configuration.VapidPublicKey = stored.VapidPublicKey;
        configuration.VapidPrivateKey = stored.VapidPrivateKey;
        configuration.PushWebhookSecret = stored.PushWebhookSecret;
    }

    private PushSecrets WritePushSecrets(PluginConfiguration config)
    {
        var secrets = new PushSecrets(VapidKeys.Generate(), Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(24)));
        config.VapidPublicKey = secrets.Keys.PublicKey;
        config.VapidPrivateKey = secrets.Keys.PrivateKey;
        config.PushWebhookSecret = secrets.WebhookSecret;
        _reader.Write(config);
        return secrets;
    }

    private ConfigSaveResult SaveLocked(PluginConfiguration configuration)
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

        // Web Push's keys are Lumen's own to make: whatever a save carries, the stored ones stay.
        KeepPushSecrets(configuration, stored);

        var errors = _validator.Validate(configuration);
        if (errors.Count > 0)
        {
            return new ConfigSaveResult(false, errors);
        }

        _reader.Write(configuration);
        return new ConfigSaveResult(true, []);
    }
}
