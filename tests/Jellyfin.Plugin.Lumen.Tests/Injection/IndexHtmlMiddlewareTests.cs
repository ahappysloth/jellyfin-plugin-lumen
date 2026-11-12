using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Injection;
using MediaBrowser.Controller;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Injection;

public sealed class IndexHtmlMiddlewareTests : IDisposable
{
    private const string IndexHtml = "<!DOCTYPE html><html><head><title>Jellyfin</title></head><body><div id=\"reactRoot\"></div></body></html>";
    private const string ConfigJson = "{\"multiserver\":false,\"menuLinks\":[],\"plugins\":[\"htmlVideoPlayer/plugin\",\"syncPlay/plugin\"]}";

    /// <summary>A build with the guard and the definer of Lumen's jellyfin-web plugin (client/src/compat/webPluginDefiner.js).</summary>
    private static readonly Dictionary<string, byte[]> PluginBuild = Build(
        guard: "guard()",
        webPlugin: "window." + WebConfigInjector.PluginName + "=function(){return function(){}};");

    private readonly string _webRoot = Directory.CreateTempSubdirectory("lumen-web").FullName;

    public IndexHtmlMiddlewareTests()
    {
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), IndexHtml);
        File.WriteAllText(Path.Combine(_webRoot, "main.js"), "console.log('stock')");
        File.WriteAllText(Path.Combine(_webRoot, "config.json"), ConfigJson);
    }

    public void Dispose() => Directory.Delete(_webRoot, recursive: true);

    [Theory]
    [InlineData("/web/index.html")]
    [InlineData("/web/")]
    public async Task InjectsIntoIndex(string path)
    {
        using var host = await StartAsync();
        var response = await host.GetTestClient().GetAsync(path);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(HtmlInjector.Marker, body, StringComparison.Ordinal);
        Assert.Equal(Encoding.UTF8.GetByteCount(body), response.Content.Headers.ContentLength);
        Assert.StartsWith("\"lmn-", response.Headers.ETag?.Tag, StringComparison.Ordinal);
        Assert.Null(response.Content.Headers.LastModified);
    }

    [Fact]
    public async Task Injects_WhenServerUsesBaseUrl()
    {
        using var host = await StartAsync();
        var body = await host.GetTestClient().GetStringAsync("/jellyfin/web/index.html");

        Assert.Contains("../Lumen/Assets/lumen.js", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task InlinesTheGuardAndTheWebPluginDefinersRawBytes_AfterTheyWereServedCompressed()
    {
        const string Guard = "window.lumenGuard = 'raw';";
        var definer = "window." + WebConfigInjector.PluginName + " = function () { return 'raw'; };";
        var assets = new AssetCatalog(Build(Guard, definer));
        foreach (var name in new[] { HtmlInjector.GuardAsset, HtmlInjector.WebPluginAsset })
        {
            Assert.True(assets.TryGet(name, out var asset));
            Assert.Equal("br", asset.Select("br").ContentEncoding);
            Assert.Equal("gzip", asset.Select("gzip").ContentEncoding);
        }

        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => new PluginConfiguration())), catalog: () => assets);
        var client = host.GetTestClient();

        var body = await client.GetStringAsync("/web/index.html");

        Assert.Contains(Guard + "</script>", body, StringComparison.Ordinal); // after the skin flag, in the same script
        Assert.Contains("<script>" + definer + "</script>", body, StringComparison.Ordinal);
        Assert.Contains(WebConfigInjector.PluginName, Plugins(await client.GetStringAsync("/web/config.json")));
    }

    [Fact]
    public async Task ReturnsUncompressedInjectedHtml_WhenThePageIsSmall()
    {
        using var host = await StartAsync();
        var request = new HttpRequestMessage(HttpMethod.Get, "/web/index.html");
        request.Headers.AcceptEncoding.Add(new StringWithQualityHeaderValue("gzip"));

        var response = await host.GetTestClient().SendAsync(request);

        Assert.Empty(response.Content.Headers.ContentEncoding);
        Assert.Contains(HtmlInjector.Marker, await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("gzip", "gzip", "-gz\"")]
    [InlineData("gzip, deflate, br", "br", "-br\"")]
    [InlineData("br;q=0, gzip", "gzip", "-gz\"")]
    [InlineData("identity", null, null)]
    public async Task CompressesTheRewrittenPage_ForClientsThatAcceptIt(string accept, string? encoding, string? etagSuffix)
    {
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), IndexHtml.Replace("</head>", "<!--" + new string('x', 4096) + "--></head>", StringComparison.Ordinal));
        using var host = await StartAsync();
        var request = new HttpRequestMessage(HttpMethod.Get, "/web/index.html");
        request.Headers.TryAddWithoutValidation("Accept-Encoding", accept);

        var response = await host.GetTestClient().SendAsync(request);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Stream body = new MemoryStream(bytes);
        body = encoding switch
        {
            "gzip" => new GZipStream(body, CompressionMode.Decompress),
            "br" => new BrotliStream(body, CompressionMode.Decompress),
            _ => body,
        };
        var html = await new StreamReader(body).ReadToEndAsync();

        Assert.Equal(encoding is null ? [] : [encoding], response.Content.Headers.ContentEncoding);
        Assert.Contains("Accept-Encoding", response.Headers.Vary);
        Assert.Equal(bytes.Length, response.Content.Headers.ContentLength);
        Assert.Contains(HtmlInjector.Marker, html, StringComparison.Ordinal);
        if (etagSuffix is null)
        {
            Assert.DoesNotContain("-", response.Headers.ETag!.Tag[5..], StringComparison.Ordinal);
        }
        else
        {
            Assert.EndsWith(etagSuffix, response.Headers.ETag!.Tag, StringComparison.Ordinal);
        }

        // A revalidation with that representation's ETag is a 304.
        var again = new HttpRequestMessage(HttpMethod.Get, "/web/index.html");
        again.Headers.TryAddWithoutValidation("Accept-Encoding", accept);
        again.Headers.TryAddWithoutValidation("If-None-Match", "\"other\", " + response.Headers.ETag!.Tag);
        Assert.Equal(HttpStatusCode.NotModified, (await host.GetTestClient().SendAsync(again)).StatusCode);
    }

    [Fact]
    public async Task FailsOpen_ServingTheOriginalPage_WhenLumenCantReadItsConfig()
    {
        var config = Substitute.For<ILumenConfigReader>();
        config.Current.Returns(_ => throw new InvalidOperationException("The Lumen plugin has not been initialized."));
        using var host = await StartAsync(services: s => s.AddSingleton(config));

        var response = await host.GetTestClient().GetAsync("/web/index.html");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(IndexHtml, await response.Content.ReadAsStringAsync());
        Assert.DoesNotContain("lmn-", response.Headers.ETag?.Tag ?? string.Empty, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheRewrittenPage_FollowsConfigChanges_AndPageChanges()
    {
        var current = new PluginConfiguration { ConfigVersion = 1, StyleStockPages = true };
        var config = Substitute.For<ILumenConfigReader>();
        config.Current.Returns(_ => current);
        using var host = await StartAsync(services: s => s.AddSingleton(config));
        var client = host.GetTestClient();

        var first = await client.GetAsync("/web/index.html");
        var same = await client.GetAsync("/web/index.html");
        current = new PluginConfiguration { ConfigVersion = 2, StyleStockPages = false };
        var restyled = await client.GetStringAsync("/web/index.html");
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), IndexHtml.Replace("Jellyfin", "Jellyfin 12.2", StringComparison.Ordinal));
        var upgraded = await client.GetStringAsync("/web/index.html");

        Assert.Contains("data-lmn-skin", await first.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Equal(first.Headers.ETag, same.Headers.ETag);
        Assert.DoesNotContain("data-lmn-skin", restyled, StringComparison.Ordinal);
        Assert.Contains("Jellyfin 12.2", upgraded, StringComparison.Ordinal);
        Assert.Contains(HtmlInjector.Marker, upgraded, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("")]
    [InlineData("/jellyfin")]
    public async Task InstallsAsLumen_WhileLumenIsOn_AndAsJellyfinWhenItIsOff(string baseUrl)
    {
        UseRealPage();
        var current = new PluginConfiguration { ConfigVersion = 1 };
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => current)));
        var client = host.GetTestClient();
        var pageUrl = new Uri($"http://lumen.test{baseUrl}/web/");

        var on = await client.GetStringAsync(pageUrl);
        current = new PluginConfiguration { ConfigVersion = 2, Enabled = false };
        var off = await client.GetStringAsync(pageUrl);

        // A home-screen install resolves the manifest against the page, so it lands under the base URL, where Jellyfin
        // serves /Lumen/Manifest (anonymously: LumenControllerTests).
        var manifest = Regex.Match(on, "<link rel=\"manifest\" href=\"([^\"]+)\">").Groups[1].Value;
        Assert.Equal($"{baseUrl}/Lumen/Manifest", new Uri(pageUrl, manifest).AbsolutePath);
        var touchIcon = Regex.Match(on, "<link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"([^\"]+)\">").Groups[1].Value;
        Assert.Equal($"{baseUrl}/Lumen/Assets/lumen-icon-180.png", new Uri(pageUrl, touchIcon).AbsolutePath);
        Assert.Contains("<meta name=\"apple-mobile-web-app-title\" content=\"Lumen\">", on, StringComparison.Ordinal);
        Assert.Contains("<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">", on, StringComparison.Ordinal);
        Assert.DoesNotContain("manifest.json", on, StringComparison.Ordinal);

        Assert.Contains("<link rel=\"manifest\" href=\"manifest.json\">", off, StringComparison.Ordinal);
        Assert.Contains("<meta name=\"application-name\" content=\"Jellyfin\">", off, StringComparison.Ordinal);
        Assert.Contains("<meta id=\"themeColor\" name=\"theme-color\" content=\"#202020\">", off, StringComparison.Ordinal);
        Assert.DoesNotContain("apple-mobile-web-app-title", off, StringComparison.Ordinal);
        Assert.DoesNotContain("lumen-icon", off, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("")]
    [InlineData("/jellyfin")]
    public async Task TheStockPagesStylesheets_AreTheGuards_WithLumensVersion_UnderTheBaseUrl(string baseUrl)
    {
        UseRealPage();
        var current = new PluginConfiguration { ConfigVersion = 1, StyleStockPages = true };
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => current)));
        var client = host.GetTestClient();
        var pageUrl = new Uri($"http://lumen.test{baseUrl}/web/");

        var on = await client.GetStringAsync(pageUrl);
        current = new PluginConfiguration { ConfigVersion = 2, StyleStockPages = false };
        var off = await client.GetStringAsync(pageUrl);

        // The guard links lumen-stock.css and lumen-dashboard.css itself (client/src/veil/skinCss.ts), beside lumen.css
        // and with its version, so they land under the base URL and are cached for good like it.
        var lumenCss = Regex.Match(on, "<link rel=\"stylesheet\" href=\"([^\"?]+)lumen[.]css[?]v=([^\"]+)\">");
        Assert.True(lumenCss.Success);
        Assert.Equal("../Lumen/Assets/", lumenCss.Groups[1].Value);
        Assert.Equal($"{baseUrl}/Lumen/Assets/lumen-stock.css", new Uri(pageUrl, "../Lumen/Assets/lumen-stock.css").AbsolutePath);
        var meta = $"<meta name=\"lumen-version\" content=\"{lumenCss.Groups[2].Value}\">";
        Assert.Contains(meta, on, StringComparison.Ordinal);
        Assert.True(on.IndexOf(meta, StringComparison.Ordinal) < on.IndexOf("data-lmn-skin", StringComparison.Ordinal));
        Assert.DoesNotContain("lumen-dashboard.css", on, StringComparison.Ordinal);

        Assert.DoesNotContain("lumen-version", off, StringComparison.Ordinal);
        Assert.DoesNotContain("data-lmn-skin", off, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheHomeScreenName_IsLumens_OrFollowsTheServersName_WhenTheAdminAsks()
    {
        UseRealPage();
        var current = new PluginConfiguration { ConfigVersion = 1 };
        var server = Substitute.For<IServerApplicationHost>();
        server.FriendlyName.Returns("Den");
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => current)).AddSingleton(server));
        var client = host.GetTestClient();

        var lumen = await client.GetStringAsync("/web/");
        current = new PluginConfiguration { ConfigVersion = 2, AppNameFromServer = true };
        var den = await client.GetStringAsync("/web/");
        server.FriendlyName.Returns("Loft"); // renamed in Jellyfin's settings: Lumen's config doesn't change
        var loft = await client.GetStringAsync("/web/");

        Assert.Contains("<meta name=\"apple-mobile-web-app-title\" content=\"Lumen\">", lumen, StringComparison.Ordinal);
        Assert.Contains("<meta name=\"apple-mobile-web-app-title\" content=\"Den\">", den, StringComparison.Ordinal);
        Assert.Contains("<meta name=\"application-name\" content=\"Den\">", den, StringComparison.Ordinal);
        Assert.Contains("<meta name=\"apple-mobile-web-app-title\" content=\"Loft\">", loft, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Returns304_ForMatchingEtag_AndFullPageOtherwise()
    {
        using var host = await StartAsync();
        var client = host.GetTestClient();
        var etag = (await client.GetAsync("/web/index.html")).Headers.ETag!.Tag;

        var conditional = new HttpRequestMessage(HttpMethod.Get, "/web/index.html");
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        var notModified = await client.SendAsync(conditional);

        var stale = new HttpRequestMessage(HttpMethod.Get, "/web/index.html");
        stale.Headers.TryAddWithoutValidation("If-None-Match", "\"stock-etag\"");
        var full = await client.SendAsync(stale);

        Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);
        Assert.Empty(await notModified.Content.ReadAsByteArrayAsync());
        Assert.Equal(HttpStatusCode.OK, full.StatusCode);
        Assert.Contains(HtmlInjector.Marker, await full.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task PassesThroughOtherFiles_AndMissingFiles()
    {
        using var host = await StartAsync();
        var client = host.GetTestClient();

        Assert.Equal("console.log('stock')", await client.GetStringAsync("/web/main.js"));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/web/missing.html")).StatusCode);
    }

    [Fact]
    public async Task CoexistsWithAnotherInjector_InEitherOrder()
    {
        using var outer = await StartAsync(outer: app => app.UseMiddleware<OtherInjector>());
        using var inner = await StartAsync(inner: app => app.UseMiddleware<OtherInjector>());

        foreach (var host in new[] { outer, inner })
        {
            var body = await host.GetTestClient().GetStringAsync("/web/index.html");
            Assert.Contains("<!-- other -->", body, StringComparison.Ordinal);
            Assert.Single(body.Split(HtmlInjector.Marker)[1..]);
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData("/jellyfin")]
    public async Task ListsTheWebPlugin_InConfigJson_OnceThePageDefinesIt(string baseUrl)
    {
        var current = new PluginConfiguration { ConfigVersion = 3 };
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => current)), build: PluginBuild);
        var client = host.GetTestClient();

        var page = await client.GetStringAsync(baseUrl + "/web/");
        var response = await client.GetAsync(baseUrl + "/web/config.json");
        var json = await response.Content.ReadAsStringAsync();

        Assert.Contains(WebConfigInjector.PluginName, page, StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(["htmlVideoPlayer/plugin", "syncPlay/plugin", WebConfigInjector.PluginName], Plugins(json));
        Assert.False(JsonNode.Parse(json)!["multiserver"]!.GetValue<bool>());
        Assert.Equal(Encoding.UTF8.GetByteCount(json), response.Content.Headers.ContentLength);
        Assert.StartsWith("\"lmn-", response.Headers.ETag?.Tag, StringComparison.Ordinal);
        Assert.Null(response.Content.Headers.LastModified);

        // Served again from the cache, with the same ETag; a revalidation with it is a 304.
        var again = new HttpRequestMessage(HttpMethod.Get, baseUrl + "/web/config.json");
        again.Headers.TryAddWithoutValidation("If-None-Match", response.Headers.ETag!.Tag);
        Assert.Equal(HttpStatusCode.NotModified, (await client.SendAsync(again)).StatusCode);
        Assert.Equal(json, await client.GetStringAsync(baseUrl + "/web/config.json"));
    }

    [Fact]
    public async Task ListsTheWebPlugin_OnlyOnce_WhenConfigJsonAlreadyHasIt()
    {
        var listed = ConfigJson.Replace("\"syncPlay/plugin\"", "\"syncPlay/plugin\",\"" + WebConfigInjector.PluginName + "\"", StringComparison.Ordinal);
        File.WriteAllText(Path.Combine(_webRoot, "config.json"), listed);
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => new PluginConfiguration())), build: PluginBuild);
        var client = host.GetTestClient();

        await client.GetStringAsync("/web/");

        Assert.Equal(listed, await client.GetStringAsync("/web/config.json"));
    }

    [Fact]
    public async Task LeavesConfigJsonAlone_WhenLumenIsOff()
    {
        var current = new PluginConfiguration { ConfigVersion = 1 };
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => current)), build: PluginBuild);
        var client = host.GetTestClient();
        await client.GetStringAsync("/web/");
        Assert.Contains(WebConfigInjector.PluginName, await client.GetStringAsync("/web/config.json"), StringComparison.Ordinal);

        // Switched off: the page drops the guard, and config.json stops listing the plugin, whichever is fetched first.
        current = new PluginConfiguration { ConfigVersion = 2, Enabled = false };
        var stale = await client.GetAsync("/web/config.json");
        var page = await client.GetStringAsync("/web/");
        var fresh = await client.GetStringAsync("/web/config.json");

        Assert.Equal(ConfigJson, await stale.Content.ReadAsStringAsync());
        Assert.DoesNotContain("lmn-", stale.Headers.ETag?.Tag ?? string.Empty, StringComparison.Ordinal);
        Assert.DoesNotContain(WebConfigInjector.PluginName, page, StringComparison.Ordinal);
        Assert.Equal(ConfigJson, fresh);
    }

    [Fact]
    public async Task LeavesConfigJsonAlone_UntilAPageWithTheGuardIsServed()
    {
        using var noPage = await StartAsync(services: s => s.AddSingleton(Config(() => new PluginConfiguration())), build: PluginBuild);
        using var noGuard = await StartAsync(services: s => s.AddSingleton(Config(() => new PluginConfiguration())));

        // Nothing served yet (a fresh start), and a build without the guard.
        Assert.Equal(ConfigJson, await noPage.GetTestClient().GetStringAsync("/web/config.json"));
        await noGuard.GetTestClient().GetStringAsync("/web/");
        Assert.Equal(ConfigJson, await noGuard.GetTestClient().GetStringAsync("/web/config.json"));
    }

    [Fact]
    public async Task LeavesConfigJsonAlone_WhenThePageCouldNotTakeTheGuard()
    {
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), "<html><body>no head</body></html>");
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => new PluginConfiguration())), build: PluginBuild);
        var client = host.GetTestClient();

        Assert.DoesNotContain(WebConfigInjector.PluginName, await client.GetStringAsync("/web/"), StringComparison.Ordinal);
        Assert.Equal(ConfigJson, await client.GetStringAsync("/web/config.json"));
    }

    [Fact]
    public async Task LeavesConfigJsonAlone_AfterTheRewriteOfThePageFails()
    {
        var fail = false;
        using var host = await StartAsync(
            services: s => s.AddSingleton(Config(() => fail ? throw new InvalidOperationException("store") : new PluginConfiguration())),
            build: PluginBuild);
        var client = host.GetTestClient();
        await client.GetStringAsync("/web/");

        // The page went out unchanged, so it doesn't define the plugin; config.json mustn't list it, even once the
        // store recovers, until a page with the guard is served again.
        fail = true;
        Assert.Equal(IndexHtml, await client.GetStringAsync("/web/"));
        fail = false;
        Assert.Equal(ConfigJson, await client.GetStringAsync("/web/config.json"));
    }

    [Fact]
    public async Task LeavesAnUnusableConfigJsonAlone()
    {
        File.WriteAllText(Path.Combine(_webRoot, "config.json"), "{\"themes\":[]}");
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => new PluginConfiguration())), build: PluginBuild);
        var client = host.GetTestClient();
        await client.GetStringAsync("/web/");

        Assert.Equal("{\"themes\":[]}", await client.GetStringAsync("/web/config.json"));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/web/other/missing.json")).StatusCode);
    }

    [Fact]
    public async Task ConfigJsonListing_FollowsEnabled_EvenWithoutANewConfigVersion()
    {
        var current = new PluginConfiguration { ConfigVersion = 4 };
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => current)), build: PluginBuild);
        var client = host.GetTestClient();
        await client.GetStringAsync("/web/");

        current = new PluginConfiguration { ConfigVersion = 4, Enabled = false };

        Assert.Equal(ConfigJson, await client.GetStringAsync("/web/config.json"));
    }

    [Fact]
    public async Task LeavesConfigJsonAlone_AfterAnUpdate_UntilThatBuildsPageIsServed()
    {
        var current = new AssetCatalog(PluginBuild);
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => new PluginConfiguration())), catalog: () => current);
        var client = host.GetTestClient();
        await client.GetStringAsync("/web/");

        // An update without the definer (or with a different one): the cached page was the old build's.
        current = new AssetCatalog(Build(guard: "guard()", webPlugin: null));
        Assert.Equal(ConfigJson, await client.GetStringAsync("/web/config.json"));
    }

    [Theory]
    [InlineData("window.LumenGuard=1", "window.SomeoneElse=function(){}")]
    [InlineData("window.LumenWebPlugin=function(){}", null)]
    public async Task LeavesConfigJsonAlone_WhenThePagesScriptsDontDefineThePlugin(string guard, string? webPlugin)
    {
        // The definer must name the plugin; a guard that does is no substitute (it doesn't parse everywhere).
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => new PluginConfiguration())), build: Build(guard, webPlugin));
        var client = host.GetTestClient();
        await client.GetStringAsync("/web/");

        Assert.Equal(ConfigJson, await client.GetStringAsync("/web/config.json"));
    }

    [Fact]
    public async Task TheListingConfigJson_IsRevalidatedEveryTime()
    {
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => new PluginConfiguration())), build: PluginBuild);
        var client = host.GetTestClient();
        var page = await client.GetAsync("/web/");
        var config = await client.GetAsync("/web/config.json");

        Assert.Contains(WebConfigInjector.PluginName, await config.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.True(config.Headers.CacheControl?.NoCache);
        Assert.True(page.Headers.CacheControl?.NoCache);
    }

    [Fact]
    public async Task ListsTheWebPlugin_InAConfigJsonSavedWithAByteOrderMark()
    {
        File.WriteAllText(Path.Combine(_webRoot, "config.json"), ConfigJson, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        using var host = await StartAsync(services: s => s.AddSingleton(Config(() => new PluginConfiguration())), build: PluginBuild);
        var client = host.GetTestClient();
        await client.GetStringAsync("/web/");

        var json = await client.GetStringAsync("/web/config.json");

        Assert.Equal(["htmlVideoPlayer/plugin", "syncPlay/plugin", WebConfigInjector.PluginName], Plugins(json));
    }

    private static Dictionary<string, byte[]> Build(string? guard, string? webPlugin)
    {
        var files = new Dictionary<string, byte[]> { ["lumen.js"] = "x"u8.ToArray() };
        if (guard is not null)
        {
            files[HtmlInjector.GuardAsset] = Encoding.UTF8.GetBytes(guard);
        }

        if (webPlugin is not null)
        {
            files[HtmlInjector.WebPluginAsset] = Encoding.UTF8.GetBytes(webPlugin);
        }

        return files;
    }

    private static ILumenConfigReader Config(Func<PluginConfiguration> current)
    {
        var config = Substitute.For<ILumenConfigReader>();
        config.Current.Returns(_ => current());
        return config;
    }

    private static string[] Plugins(string json) =>
        JsonNode.Parse(json)!["plugins"]!.AsArray().Select(p => p!.GetValue<string>()).ToArray();

    /// <summary>Serves jellyfin-web 12.4's index.html (with the tags Lumen swaps) rather than the minimal page.</summary>
    private void UseRealPage() => File.Copy(
        Path.Combine(AppContext.BaseDirectory, "Injection", "Fixtures", "jellyfin-web-12.4.index.html"),
        Path.Combine(_webRoot, "index.html"),
        overwrite: true);

    private async Task<IHost> StartAsync(Action<IApplicationBuilder>? outer = null, Action<IApplicationBuilder>? inner = null, Action<IServiceCollection>? services = null, Dictionary<string, byte[]>? build = null, Func<AssetCatalog>? catalog = null)
    {
        var host = new HostBuilder()
            .ConfigureWebHost(web => web
                .UseTestServer()
                .ConfigureServices(collection =>
                {
                    var fixedCatalog = new AssetCatalog(build ?? new Dictionary<string, byte[]> { ["lumen.js"] = "x"u8.ToArray() });
                    collection.AddScoped(_ => catalog?.Invoke() ?? fixedCatalog);
                    collection.AddResponseCompression();
                    services?.Invoke(collection);
                })
                .Configure(app =>
                {
                    // Mirrors Jellyfin: plugin startup-filter middleware runs before Map(BaseUrl) and compression.
                    outer?.Invoke(app);
                    app.UseMiddleware<IndexHtmlMiddleware>();
                    inner?.Invoke(app);
                    app.UseResponseCompression();
                    app.Map("/jellyfin", ConfigureWeb);
                    ConfigureWeb(app);
                }))
            .Build();
        await host.StartAsync();
        return host;
    }

    private void ConfigureWeb(IApplicationBuilder app)
    {
        var files = new PhysicalFileProvider(_webRoot);
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files, RequestPath = "/web" });
        app.UseStaticFiles(new StaticFileOptions { FileProvider = files, RequestPath = "/web" });
    }

    /// <summary>Simulates another plugin that rewrites index.html.</summary>
    private sealed class OtherInjector
    {
        private readonly RequestDelegate _next;

        public OtherInjector(RequestDelegate next) => _next = next;

        public async Task InvokeAsync(HttpContext context)
        {
            if (!context.Request.Path.Value!.EndsWith("/web/index.html", StringComparison.Ordinal))
            {
                await _next(context);
                return;
            }

            context.Request.Headers.AcceptEncoding = string.Empty;
            var original = context.Response.Body;
            using var buffer = new MemoryStream();
            context.Response.Body = buffer;
            await _next(context);
            context.Response.Body = original;
            var html = Encoding.UTF8.GetString(buffer.ToArray()).Replace("</head>", "<!-- other --></head>", StringComparison.Ordinal);
            var bytes = Encoding.UTF8.GetBytes(html);
            context.Response.ContentLength = bytes.Length;
            await original.WriteAsync(bytes);
        }
    }
}
