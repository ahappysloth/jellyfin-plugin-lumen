using System.Text;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using MediaBrowser.Controller;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class LumenControllerTests
{
    private readonly AssetCatalog _assets = new(new Dictionary<string, byte[]>
    {
        ["lumen.js"] = Encoding.UTF8.GetBytes("x"),
        ["lumen-chunk-main-AbC123.js"] = Encoding.UTF8.GetBytes("y"),
        ["lumen-icon-192.png"] = [0x89, 0x50, 0x4e, 0x47],
    });

    private readonly ILumenConfigStore _config = Substitute.For<ILumenConfigStore>();
    private readonly DiagnosticsStore _diagnostics = new();
    private readonly IServerApplicationHost _host = Substitute.For<IServerApplicationHost>();

    [Fact]
    public void Manifest_IsLumens_WithItsIconsAndColour_UnderWebScope()
    {
        _host.FriendlyName.Returns("Den");
        _config.Current.Returns(new PluginConfiguration());
        var controller = Create();

        var result = Assert.IsType<ContentResult>(controller.GetManifest());

        Assert.Equal("application/manifest+json", result.ContentType);
        Assert.Equal("no-cache", controller.Response.Headers.CacheControl.ToString());
        using var json = System.Text.Json.JsonDocument.Parse(result.Content!);
        var root = json.RootElement;
        Assert.Equal("Lumen", root.GetProperty("name").GetString());
        Assert.Equal("Lumen", root.GetProperty("short_name").GetString());
        Assert.Equal("standalone", root.GetProperty("display").GetString());
        Assert.Equal("any", root.GetProperty("orientation").GetString());
        Assert.Equal("#0f0f0f", root.GetProperty("theme_color").GetString());
        Assert.Equal("#0f0f0f", root.GetProperty("background_color").GetString());

        // Relative to /Lumen/Manifest, so they hold under any base URL: <base>/web/ and <base>/Lumen/Assets/.
        Assert.Equal("../web/", root.GetProperty("scope").GetString());
        Assert.StartsWith("../web/", root.GetProperty("start_url").GetString(), StringComparison.Ordinal);
        var icons = root.GetProperty("icons").EnumerateArray().ToList();
        Assert.All(icons, i => Assert.StartsWith("Assets/lumen-icon-", i.GetProperty("src").GetString(), StringComparison.Ordinal));
        Assert.Contains(icons, i => i.GetProperty("sizes").GetString() == "192x192" && i.GetProperty("purpose").GetString() == "any");
        Assert.Contains(icons, i => i.GetProperty("sizes").GetString() == "512x512" && i.GetProperty("purpose").GetString() == "any");
        Assert.Contains(icons, i => i.GetProperty("sizes").GetString() == "512x512" && i.GetProperty("purpose").GetString() == "maskable");
    }

    [Theory]
    [InlineData("Den", "Den")]
    [InlineData("  ", "Lumen")]
    [InlineData(null, "Lumen")]
    public void Manifest_TakesTheServersName_WhenTheAdminAsks(string? serverName, string expected)
    {
        _host.FriendlyName.Returns(serverName);
        _config.Current.Returns(new PluginConfiguration { AppNameFromServer = true });

        var result = Assert.IsType<ContentResult>(Create().GetManifest());

        using var json = System.Text.Json.JsonDocument.Parse(result.Content!);
        Assert.Equal(expected, json.RootElement.GetProperty("name").GetString());
        Assert.Equal(expected, json.RootElement.GetProperty("short_name").GetString());
    }

    [Fact]
    public void Asset_IsImmutable_WhenVersionMatches()
    {
        var controller = Create();

        var result = Assert.IsType<FileContentResult>(controller.GetAsset("lumen.js", _assets.BuildHash));

        Assert.Equal("text/javascript; charset=utf-8", result.ContentType);
        Assert.Equal("public, max-age=31536000, immutable", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public void Asset_IsRevalidated_WhenVersionMissingOrStale()
    {
        var controller = Create();

        controller.GetAsset("lumen.js", "old");

        Assert.Equal("no-cache", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public void ContentNamedChunk_IsImmutable_WithoutAVersion()
    {
        var controller = Create();

        Assert.IsType<FileContentResult>(controller.GetAsset("lumen-chunk-main-AbC123.js", null));

        Assert.Equal("public, max-age=31536000, immutable", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public void Asset_IsSentInTheEncodingTheClientTakes_WithItsOwnETag_AndCachingUnchanged()
    {
        var controller = Create();
        controller.Request.Headers.AcceptEncoding = "gzip, br";

        var result = Assert.IsType<FileContentResult>(controller.GetAsset("lumen.js", _assets.BuildHash));

        Assert.True(_assets.TryGet("lumen.js", out var asset));
        Assert.Equal(asset.Select("br").Content, result.FileContents);
        Assert.Equal("text/javascript; charset=utf-8", result.ContentType);
        Assert.Equal("br", controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal("Accept-Encoding", controller.Response.Headers.Vary.ToString());
        Assert.Equal(asset.Select("br").ETag, result.EntityTag);
        Assert.False(result.EnableRangeProcessing);
        Assert.Equal("public, max-age=31536000, immutable", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public void Asset_IsSentRaw_WhenTheClientTakesNoEncoding()
    {
        var controller = Create();

        var result = Assert.IsType<FileContentResult>(controller.GetAsset("lumen.js", "old"));

        Assert.Equal("x"u8.ToArray(), result.FileContents);
        Assert.Equal(0, controller.Response.Headers.ContentEncoding.Count);
        Assert.Equal("Accept-Encoding", controller.Response.Headers.Vary.ToString());
        Assert.NotNull(result.EntityTag);
        Assert.Equal("no-cache", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public void Image_IsSentAsItIs_WithoutVary()
    {
        var controller = Create();
        controller.Request.Headers.AcceptEncoding = "br";

        var result = Assert.IsType<FileContentResult>(controller.GetAsset("lumen-icon-192.png", null));

        Assert.Equal("image/png", result.ContentType);
        Assert.Equal(0, controller.Response.Headers.ContentEncoding.Count);
        Assert.Equal(0, controller.Response.Headers.Vary.Count);
    }

    [Fact]
    public void UnknownAsset_Is404()
    {
        Assert.IsType<NotFoundResult>(Create().GetAsset("../../etc/passwd", null));
    }

    [Fact]
    public void ClientConfig_ReflectsSettings()
    {
        _config.Current.Returns(new PluginConfiguration { HomeTakeover = false, AccentColor = "#123456", HeroIntervalSeconds = 9, HeroWaitForTrailer = true });

        var dto = Create().GetClientConfig().Value!;

        Assert.True(dto.Enabled);
        Assert.False(dto.HomeTakeover);
        Assert.Equal("#123456", dto.AccentColor);
        Assert.Equal(9, dto.HeroIntervalSeconds);
        Assert.True(dto.HeroWaitForTrailer);
        Assert.Equal(_assets.BuildHash, dto.BuildHash);
    }

    [Fact]
    public void Diagnostics_AreRecorded()
    {
        var result = Create().PostDiagnostics(new CompatReportDto { Client = "web", ServerVersion = "12.1.0", FailedChecks = ["skinBody"] });

        Assert.IsType<NoContentResult>(result);
        Assert.Equal(TestData.Now, Assert.Single(_diagnostics.GetAll()).LastSeen);
    }

    private LumenController Create() => new(_assets, _config, _diagnostics, new FakeTimeProvider(TestData.Now), _host, NullLogger<LumenController>.Instance)
    {
        ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
    };
}
