using System.Text;
using Jellyfin.Plugin.Lumen.Assets;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
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
    public void CoreChunk_IsTheFileLumenJsImports_IfItExists()
    {
        static AssetCatalog With(params (string Name, string Text)[] files) =>
            new(files.ToDictionary(f => f.Name, f => Encoding.UTF8.GetBytes(f.Text)));

        Assert.Equal(
            "lumen-chunk-main-B2.js",
            With(("lumen.js", "import(`./lumen-chunk-main-B2.js`);"), ("lumen-chunk-main-A1.js", "old"), ("lumen-chunk-main-B2.js", "core")).CoreChunk);
        Assert.Null(With(("lumen.js", "import(`./lumen-chunk-main-B2.js`);")).CoreChunk);
        Assert.Null(With(("lumen.js", "console.log(1)")).CoreChunk);
        Assert.Null(With(("lumen-chunk-main-B2.js", "core")).CoreChunk);
    }

    [Fact]
    public async Task StartPrecompression_MakesTheTextFilesEncodings_InTheBackground_Once()
    {
        var catalog = Catalog();
        Assert.True(catalog.TryGet("lumen.css", out var css));
        Assert.True(catalog.TryGet("lumen.js", out var js));
        Assert.False(css.IsPrecompressed);

        var task = catalog.StartPrecompression(NullLogger.Instance);
        await task;

        Assert.True(css.IsPrecompressed);
        Assert.True(js.IsPrecompressed);
        Assert.Same(task, catalog.StartPrecompression(NullLogger.Instance));
        Assert.Equal("body{}", Encoding.UTF8.GetString(css.Content));
    }

    [Fact]
    public async Task StartPrecompression_LogsAFileThatFails_AndCarriesOn()
    {
        var logger = new ListLogger<AssetCatalogTests>();
        var catalog = new AssetCatalog(
            new Dictionary<string, byte[]> { ["bad.css"] = "a{}"u8.ToArray(), ["lumen.css"] = "b{}"u8.ToArray() },
            (content, coding) => content.Length > 0 && content[0] == (byte)'a' ? throw new InvalidOperationException("boom") : content);

        await catalog.StartPrecompression(logger);

        Assert.True(catalog.TryGet("lumen.css", out var good));
        Assert.True(good.IsPrecompressed);
        Assert.True(catalog.TryGet("bad.css", out var bad));
        Assert.False(bad.IsPrecompressed);
        var entry = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Error, entry.Level);
        Assert.Contains("bad.css", entry.Message, StringComparison.Ordinal);
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
