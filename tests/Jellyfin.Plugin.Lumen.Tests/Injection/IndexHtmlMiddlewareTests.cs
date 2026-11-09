using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Injection;
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
    private readonly string _webRoot = Directory.CreateTempSubdirectory("lumen-web").FullName;

    public IndexHtmlMiddlewareTests()
    {
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), IndexHtml);
        File.WriteAllText(Path.Combine(_webRoot, "main.js"), "console.log('stock')");
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

    private async Task<IHost> StartAsync(Action<IApplicationBuilder>? outer = null, Action<IApplicationBuilder>? inner = null, Action<IServiceCollection>? services = null)
    {
        var host = new HostBuilder()
            .ConfigureWebHost(web => web
                .UseTestServer()
                .ConfigureServices(collection =>
                {
                    collection.AddSingleton(new AssetCatalog(new Dictionary<string, byte[]> { ["lumen.js"] = "x"u8.ToArray() }));
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
