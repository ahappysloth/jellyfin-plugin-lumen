using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.Lumen;

/// <summary>Lumen plugin entry point.</summary>
public class LumenPlugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public static readonly Guid PluginId = Guid.Parse("186f9cb8-ba8e-4555-a700-ffa619f48264");

    private readonly IServiceProvider? _services;

    public LumenPlugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : this(applicationPaths, xmlSerializer, null)
    {
    }

    /// <summary>Initializes a new instance of the <see cref="LumenPlugin"/> class.</summary>
    /// <param name="applicationPaths">Jellyfin's paths.</param>
    /// <param name="xmlSerializer">Jellyfin's XML serializer.</param>
    /// <param name="services">
    /// Jellyfin's service provider: Jellyfin creates plugins from it, after plugin services are registered. Only used to
    /// reach <see cref="ILumenConfigStore"/> in <see cref="UpdateConfiguration"/>.
    /// </param>
    [ActivatorUtilitiesConstructor]
    public LumenPlugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer, IServiceProvider? services)
        : base(applicationPaths, xmlSerializer)
    {
        _services = services;
        Instance = this;
    }

    /// <summary>Gets the running plugin instance (set by Jellyfin when it constructs the plugin).</summary>
    public static LumenPlugin? Instance { get; private set; }

    public override string Name => "Lumen";

    public override Guid Id => PluginId;

    public override string Description => "A cinematic home screen and details pages for Jellyfin.";

    public IEnumerable<PluginPageInfo> GetPages() =>
    [
        new PluginPageInfo
        {
            Name = Name,
            DisplayName = "Lumen",
            EmbeddedResourcePath = $"{GetType().Namespace}.Configuration.configPage.html",
        },
    ];

    /// <summary>
    /// Jellyfin's own <c>POST /Plugins/{id}/Configuration</c> (used by backup tools and scripts) lands here. It goes
    /// through <see cref="ILumenConfigStore.Save"/> like the admin page's saves: the stored Seerr key is kept when none
    /// is posted for the same address, the configuration is validated, and ConfigVersion is bumped so caches refresh.
    /// An invalid configuration throws <see cref="ArgumentException"/>, which Jellyfin answers with 400.
    /// </summary>
    public override void UpdateConfiguration(BasePluginConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        if (configuration is not PluginConfiguration lumen)
        {
            throw new ArgumentException("Not a Lumen configuration.", nameof(configuration));
        }

        if (_services?.GetService<ILumenConfigStore>() is not { } store)
        {
            // Not running inside Jellyfin's host (tests): nothing to apply the rules with.
            base.UpdateConfiguration(lumen);
            return;
        }

        var result = store.Save(lumen);
        if (!result.Success)
        {
            throw new ArgumentException("Lumen's configuration was not saved: " + string.Join(" ", result.Errors), nameof(configuration));
        }
    }

    /// <summary>Saves a configuration that <see cref="ILumenConfigStore"/> has already checked (see LumenPluginPersistence).</summary>
    internal void SaveValidatedConfiguration(PluginConfiguration configuration) => base.UpdateConfiguration(configuration);
}
