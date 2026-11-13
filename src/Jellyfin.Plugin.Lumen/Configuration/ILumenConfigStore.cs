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

    /// <summary>
    /// Web Push's key pair and the webhook secret, made and saved the first time they're asked for. Never changed by
    /// <see cref="Save"/> or <see cref="ResetToDefaults"/>: every browser's subscription is tied to the public key.
    /// </summary>
    PushSecrets GetPushSecrets();

    /// <summary>
    /// Replaces Web Push's key pair and the webhook secret. Every subscription made with the old public key stops
    /// working, so the caller drops them all.
    /// </summary>
    PushSecrets ResetPushSecrets();
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

/// <summary>What Web Push needs that no client may read: see <see cref="ILumenConfigStore.GetPushSecrets"/>.</summary>
public sealed record PushSecrets(Jellyfin.Plugin.Lumen.Push.VapidKeys Keys, string WebhookSecret)
{
    /// <summary>Never prints the secret (the keys redact their own private half).</summary>
    public override string ToString() => "PushSecrets { Keys = " + Keys + ", WebhookSecret = *** }";
}
