using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Serialization;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests;

public class LumenPluginTests
{
    [Fact]
    public void Plugin_HasStableIdentity()
    {
        var paths = Substitute.For<IApplicationPaths>();
        paths.PluginsPath.Returns("/tmp/lumen-tests/plugins");
        paths.PluginConfigurationsPath.Returns("/tmp/lumen-tests/config");

        var plugin = new LumenPlugin(paths, Substitute.For<IXmlSerializer>());

        Assert.Equal("Lumen", plugin.Name);
        Assert.Equal(Guid.Parse("186f9cb8-ba8e-4555-a700-ffa619f48264"), plugin.Id);
        Assert.Same(plugin, LumenPlugin.Instance);
    }

    [Fact]
    public void Plugin_ExposesEmbeddedConfigPage()
    {
        var paths = Substitute.For<IApplicationPaths>();
        paths.PluginsPath.Returns("/tmp/lumen-tests/plugins");
        var plugin = new LumenPlugin(paths, Substitute.For<IXmlSerializer>());

        var page = Assert.Single(plugin.GetPages());

        Assert.Equal("Lumen", page.Name);
        Assert.NotNull(typeof(LumenPlugin).Assembly.GetManifestResourceStream(page.EmbeddedResourcePath));
    }
}
