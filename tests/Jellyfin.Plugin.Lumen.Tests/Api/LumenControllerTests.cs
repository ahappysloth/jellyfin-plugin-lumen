using System.Text;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using MediaBrowser.Controller;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
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
    });

    private readonly ILumenConfigStore _config = Substitute.For<ILumenConfigStore>();
    private readonly DiagnosticsStore _diagnostics = new();
    private readonly IServerApplicationHost _host = Substitute.For<IServerApplicationHost>();

    [Fact]
    public void Manifest_UsesTheServerName_AndLumensIcons_UnderWebScope()
    {
        _host.FriendlyName.Returns("Den");

        var result = Assert.IsType<ContentResult>(Create().GetManifest());

        Assert.Equal("application/manifest+json", result.ContentType);
        using var json = System.Text.Json.JsonDocument.Parse(result.Content!);
        var root = json.RootElement;
        Assert.Equal("Den", root.GetProperty("name").GetString());
        Assert.Equal("../web/", root.GetProperty("scope").GetString());
        Assert.StartsWith("../web/", root.GetProperty("start_url").GetString(), StringComparison.Ordinal);
        Assert.Contains(root.GetProperty("icons").EnumerateArray(), i => i.GetProperty("purpose").GetString() == "maskable");
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
    public void UnknownAsset_Is404()
    {
        Assert.IsType<NotFoundResult>(Create().GetAsset("../../etc/passwd", null));
    }

    [Fact]
    public void ClientConfig_ReflectsSettings()
    {
        _config.Current.Returns(new PluginConfiguration { HomeTakeover = false, AccentColor = "#123456", HeroIntervalSeconds = 9 });

        var dto = Create().GetClientConfig().Value!;

        Assert.True(dto.Enabled);
        Assert.False(dto.HomeTakeover);
        Assert.Equal("#123456", dto.AccentColor);
        Assert.Equal(9, dto.HeroIntervalSeconds);
        Assert.Equal(_assets.BuildHash, dto.BuildHash);
    }

    [Fact]
    public void Diagnostics_AreRecorded()
    {
        var result = Create().PostDiagnostics(new CompatReportDto { Client = "web", ServerVersion = "12.1.0", FailedChecks = ["skinBody"] });

        Assert.IsType<NoContentResult>(result);
        Assert.Equal(TestData.Now, Assert.Single(_diagnostics.GetAll()).LastSeen);
    }

    private LumenController Create() => new(_assets, _config, _diagnostics, new FakeTimeProvider(TestData.Now), _host)
    {
        ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
    };
}
