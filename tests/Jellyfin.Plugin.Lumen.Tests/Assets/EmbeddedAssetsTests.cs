using System.IO.Compression;
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

        // lumen.js loads the code from content-named chunks: the core at startup, the player when a video plays, the
        // trailer preview as a title with one shows.
        Assert.StartsWith("lumen-chunk-main-", catalog.CoreChunk, StringComparison.Ordinal);
        Assert.True(catalog.TryGet("lumen.js", out var entry));
        Assert.Contains(catalog.CoreChunk!, Encoding.UTF8.GetString(entry.Content), StringComparison.Ordinal);
        Assert.Contains(catalog.Names, n => n.StartsWith("lumen-chunk-PlayerView-", StringComparison.Ordinal));
        Assert.Contains(catalog.Names, n => n.StartsWith("lumen-chunk-TrailerPreview-", StringComparison.Ordinal));
    }

    [Fact]
    public void PluginAssembly_EmbedsInter_WhichLumenCssAsksForBesideItself()
    {
        var catalog = AssetCatalog.FromEmbeddedResources(typeof(LumenPlugin).Assembly);
        Assert.True(catalog.TryGet("lumen.css", out var css));
        var stylesheet = Encoding.UTF8.GetString(css.Content);

        // Three weights (client/src/styles/fonts.css), content-named, and relative to lumen.css: /Lumen/Assets/ under
        // any base URL. Not at the server's root, where they wouldn't be found.
        var fonts = catalog.Names.Where(n => n.StartsWith(AssetCatalog.FontPrefix, StringComparison.Ordinal)).Order(StringComparer.Ordinal).ToList();
        Assert.Collection(
            fonts,
            f => Assert.StartsWith("lumen-font-inter-400-", f, StringComparison.Ordinal),
            f => Assert.StartsWith("lumen-font-inter-500-", f, StringComparison.Ordinal),
            f => Assert.StartsWith("lumen-font-inter-600-", f, StringComparison.Ordinal));
        foreach (var font in fonts)
        {
            Assert.Contains($"url(./{font})", stylesheet, StringComparison.Ordinal);
            Assert.True(catalog.TryGet(font, out var file));
            Assert.Equal("font/woff2", file.ContentType);
            Assert.Equal("wOF2"u8.ToArray(), file.Content[..4]);
        }

        Assert.DoesNotContain("url(/", stylesheet, StringComparison.Ordinal);
        Assert.DoesNotContain("data:font", stylesheet, StringComparison.Ordinal);
    }

    [Fact]
    public void EveryScriptAndStylesheet_IsOfferedCompressed_AndDecodesToTheFile()
    {
        var catalog = AssetCatalog.FromEmbeddedResources(typeof(LumenPlugin).Assembly);
        Assert.Contains(HtmlInjector.WebPluginAsset, catalog.Names);
        Assert.Contains(HtmlInjector.GuardAsset, catalog.Names);

        foreach (var name in catalog.Names.Where(n => n.EndsWith(".js", StringComparison.Ordinal) || n.EndsWith(".css", StringComparison.Ordinal)))
        {
            Assert.True(catalog.TryGet(name, out var asset));
            Assert.True(asset.Compressible, name);
            using var decoder = new BrotliStream(new MemoryStream(asset.Select("br").Content), CompressionMode.Decompress);
            using var decoded = new MemoryStream();
            decoder.CopyTo(decoded);
            Assert.Equal(asset.Content, decoded.ToArray());
        }
    }

    [Fact]
    public void TheInlineDefiner_DefinesTheWebPluginThatConfigJsonLists()
    {
        var catalog = AssetCatalog.FromEmbeddedResources(typeof(LumenPlugin).Assembly);

        // The server lists WebConfigInjector.PluginName in config.json only beside a definer that defines it under that name.
        Assert.True(catalog.TryGet(HtmlInjector.WebPluginAsset, out var definer));
        Assert.Contains("w." + WebConfigInjector.PluginName + " = function", Encoding.UTF8.GetString(definer.Content), StringComparison.Ordinal);
    }
}
