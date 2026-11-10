using System.Text;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Injection;
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

    [Fact]
    public void TheInlineGuard_DefinesTheWebPluginThatConfigJsonLists()
    {
        var catalog = AssetCatalog.FromEmbeddedResources(typeof(LumenPlugin).Assembly);

        // The server lists WebConfigInjector.PluginName in config.json only beside a guard that defines it under that name.
        Assert.True(catalog.TryGet(HtmlInjector.GuardAsset, out var guard));
        Assert.Contains(WebConfigInjector.PluginName, Encoding.UTF8.GetString(guard.Content), StringComparison.Ordinal);
    }
}
