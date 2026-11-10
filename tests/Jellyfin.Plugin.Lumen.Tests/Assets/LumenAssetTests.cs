using System.IO.Compression;
using System.Text;
using Jellyfin.Plugin.Lumen.Assets;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Assets;

public class LumenAssetTests
{
    private static readonly byte[] Script = Encoding.UTF8.GetBytes(string.Concat(Enumerable.Range(0, 400).Select(i => $"export const value{i} = {i};\n")));

    [Theory]
    [InlineData("br, gzip", "br")]
    [InlineData("gzip, deflate, br", "br")]
    [InlineData("BR", "br")]
    [InlineData("gzip", "gzip")]
    [InlineData("br;q=0, gzip", "gzip")]
    [InlineData("br;q=0, gzip;q=0", null)]
    [InlineData("*", "br")]
    [InlineData("*, br;q=0", "gzip")]
    [InlineData("*;q=0", null)]
    [InlineData("identity", null)]
    [InlineData("deflate", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    [InlineData("gzip;q=0.5, br;q=0.1", "gzip")]
    [InlineData("br;q=0.5, gzip;q=0.5", "br")]
    [InlineData("gzip, br;q=0.9", "gzip")]
    [InlineData("*;q=0.3, gzip;q=0.5", "gzip")]
    [InlineData("*;q=0.6, gzip;q=0.5", "br")]
    [InlineData("identity, gzip;q=0.5", null)]
    [InlineData("identity;q=0.5, gzip", "gzip")]
    [InlineData("gzip, identity", "gzip")]
    public void Select_TakesTheHigherQ_BrotliOnATie_AndHonoursQZero(string? acceptEncoding, string? expected)
    {
        var asset = new LumenAsset("lumen.js", Script, "text/javascript; charset=utf-8");

        Assert.Equal(expected, asset.Select(acceptEncoding).ContentEncoding);
    }

    [Theory]
    [InlineData("text/javascript", true)]
    [InlineData("text/css; charset=utf-8", true)]
    [InlineData("application/wasm", true)]
    [InlineData("image/svg+xml", true)]
    [InlineData("application/json", true)]
    [InlineData("application/x-font-ttf", true)]
    [InlineData("image/x-icon", true)]
    [InlineData("image/png", false)]
    [InlineData("image/gif", false)]
    [InlineData("font/woff2", false)]
    [InlineData("application/font-woff", false)]
    [InlineData("audio/mpeg", false)]
    [InlineData("application/vnd.ms-fontobject", false)]
    public void UncompressedTypes_AreCompressible(string contentType, bool compressible) =>
        Assert.Equal(compressible, LumenAsset.IsCompressible(contentType));

    [Fact]
    public void Images_AreAlwaysSentAsTheyAre()
    {
        var asset = new LumenAsset("lumen-icon-192.png", Script, "image/png");

        Assert.False(asset.Compressible);
        Assert.Same(asset.Identity, asset.Select("br, gzip"));
    }

    [Theory]
    [InlineData("br")]
    [InlineData("gzip")]
    public void EncodedBytes_DecodeToTheFile_AndAreSmaller(string coding)
    {
        var encoded = new LumenAsset("lumen.js", Script, "text/javascript; charset=utf-8").Select(coding).Content;
        using Stream decoder = coding == "br"
            ? new BrotliStream(new MemoryStream(encoded), CompressionMode.Decompress)
            : new GZipStream(new MemoryStream(encoded), CompressionMode.Decompress);
        using var decoded = new MemoryStream();
        decoder.CopyTo(decoded);

        Assert.Equal(Script, decoded.ToArray());
        Assert.True(encoded.Length < Script.Length / 4, $"{coding}: {encoded.Length} of {Script.Length} bytes");
    }

    [Fact]
    public void Brotli_IsAtLeastAsSmallAsJellyfinsFastestLevel()
    {
        using var fastest = new MemoryStream();
        using (var brotli = new BrotliStream(fastest, CompressionLevel.Fastest))
        {
            brotli.Write(Script);
        }

        Assert.True(new LumenAsset("lumen.js", Script, "text/javascript").Select("br").Content.Length <= fastest.ToArray().Length);
    }

    [Fact]
    public void EachCoding_HasItsOwnETag_AndEncodingIsDoneOnce()
    {
        var asset = new LumenAsset("lumen.js", Script, "text/javascript; charset=utf-8");
        var br = asset.Select("br");
        var gzip = asset.Select("gzip");

        Assert.Equal(3, new[] { asset.Identity.ETag, br.ETag, gzip.ETag }.Distinct().Count());
        Assert.EndsWith("-br\"", br.ETag.Tag.Value, StringComparison.Ordinal);
        Assert.EndsWith("-gz\"", gzip.ETag.Tag.Value, StringComparison.Ordinal);
        Assert.Equal(asset.Identity.ETag, new LumenAsset("lumen.js", Script, "text/javascript").Identity.ETag);
        Assert.Same(br, asset.Select("br, gzip"));
    }

    [Fact]
    public void AFailedCompression_SendsTheRawFile_LogsIt_AndIsRetried()
    {
        var failures = 1;
        var logger = new ListLogger<LumenAssetTests>();
        var asset = new LumenAsset("lumen.js", Script, "text/javascript; charset=utf-8", (content, coding) =>
            coding == LumenAsset.Brotli && failures-- > 0 ? throw new InvalidOperationException("boom") : content.Reverse().ToArray());

        Assert.Same(asset.Identity, asset.Select("br", logger));
        var entry = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Error, entry.Level);
        Assert.Contains("lumen.js", entry.Message, StringComparison.Ordinal);
        Assert.Equal("boom", entry.Exception?.Message);

        Assert.Equal("br", asset.Select("br", logger).ContentEncoding);
        Assert.Single(logger.Entries);
    }

    [Fact]
    public void Content_StaysTheRawFile_ForInlining()
    {
        var asset = new LumenAsset("lumen-guard.js", Script, "text/javascript; charset=utf-8");

        asset.Select("br");
        asset.Select("gzip");

        Assert.Same(Script, asset.Content);
        Assert.Same(Script, asset.Identity.Content);
    }
}
