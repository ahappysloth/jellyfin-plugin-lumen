using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.Lumen;

/// <summary>Lumen plugin entry point.</summary>
public class LumenPlugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public static readonly Guid PluginId = Guid.Parse("186f9cb8-ba8e-4555-a700-ffa619f48264");

    public LumenPlugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    /// <summary>Gets the running plugin instance (set by Jellyfin when it constructs the plugin).</summary>
    public static LumenPlugin? Instance { get; private set; }

    public override string Name => "Lumen";

    public override Guid Id => PluginId;

    public override string Description => "A cinematic home screen and details pages for Jellyfin.";

    public IEnumerable<PluginPageInfo> GetPages() => [];
}
