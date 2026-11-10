using System.Text;
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

        // lumen.js loads the code from content-named chunks: the core at startup, the player when a video plays.
        Assert.StartsWith("lumen-chunk-main-", catalog.CoreChunk, StringComparison.Ordinal);
        Assert.True(catalog.TryGet("lumen.js", out var entry));
        Assert.Contains(catalog.CoreChunk!, Encoding.UTF8.GetString(entry.Content), StringComparison.Ordinal);
        Assert.Contains(catalog.Names, n => n.StartsWith("lumen-chunk-PlayerView-", StringComparison.Ordinal));
    }
}
