using System.Text;
using Jellyfin.Plugin.Lumen.Assets;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Assets;

public class AssetCatalogTests
{
    [Fact]
    public void ServesKnownFilesWithContentTypes()
    {
        var catalog = Catalog();

        Assert.True(catalog.TryGet("lumen.js", out var js));
        Assert.Equal("text/javascript; charset=utf-8", js.ContentType);
        Assert.True(catalog.TryGet("lumen.css", out var css));
        Assert.Equal("text/css; charset=utf-8", css.ContentType);
        Assert.False(catalog.TryGet("../secret", out _));
    }

    [Fact]
    public void BuildHash_IsStable_AndChangesWithContent()
    {
        Assert.Equal(Catalog().BuildHash, Catalog().BuildHash);
        Assert.NotEqual(Catalog().BuildHash, Catalog("changed").BuildHash);
        Assert.Equal(16, Catalog().BuildHash.Length);
    }

    [Fact]
    public void EmptyCatalog_HasHash()
    {
        Assert.Equal(16, new AssetCatalog(new Dictionary<string, byte[]>()).BuildHash.Length);
    }

    private static AssetCatalog Catalog(string js = "console.log(1)") => new(new Dictionary<string, byte[]>
    {
        ["lumen.js"] = Encoding.UTF8.GetBytes(js),
        ["lumen.css"] = Encoding.UTF8.GetBytes("body{}"),
    });
}
