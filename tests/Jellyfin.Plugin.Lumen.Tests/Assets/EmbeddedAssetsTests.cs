using Jellyfin.Plugin.Lumen.Assets;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Assets;

public class EmbeddedAssetsTests
{
    [Fact]
    public void PluginAssembly_EmbedsClientBundle()
    {
        var catalog = AssetCatalog.FromEmbeddedResources(typeof(LumenPlugin).Assembly);

        Assert.Contains("lumen.js", catalog.Names);
        Assert.Contains("lumen.css", catalog.Names);
    }
}
