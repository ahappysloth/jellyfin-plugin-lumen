namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Persists configuration through Jellyfin's plugin configuration mechanism.</summary>
public sealed class LumenPluginPersistence : IPluginConfigPersistence
{
    private static LumenPlugin Plugin =>
        LumenPlugin.Instance ?? throw new InvalidOperationException("The Lumen plugin has not been initialized.");

    public PluginConfiguration Load() => Plugin.Configuration;

    public void Save(PluginConfiguration configuration) => Plugin.UpdateConfiguration(configuration);
}
