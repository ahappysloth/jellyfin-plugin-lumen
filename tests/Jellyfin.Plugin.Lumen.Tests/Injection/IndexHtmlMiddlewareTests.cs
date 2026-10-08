using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Injection;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
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
    public async Task ReturnsUncompressedInjectedHtml_WhenClientAcceptsGzip()
    {
        using var host = await StartAsync();
        var request = new HttpRequestMessage(HttpMethod.Get, "/web/index.html");
        request.Headers.AcceptEncoding.Add(new StringWithQualityHeaderValue("gzip"));

        var response = await host.GetTestClient().SendAsync(request);

        Assert.Empty(response.Content.Headers.ContentEncoding);
        Assert.Contains(HtmlInjector.Marker, await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
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

    private async Task<IHost> StartAsync(Action<IApplicationBuilder>? outer = null, Action<IApplicationBuilder>? inner = null)
    {
        var host = new HostBuilder()
            .ConfigureWebHost(web => web
                .UseTestServer()
                .ConfigureServices(services =>
                {
                    services.AddSingleton(new AssetCatalog(new Dictionary<string, byte[]> { ["lumen.js"] = "x"u8.ToArray() }));
                    services.AddResponseCompression();
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
