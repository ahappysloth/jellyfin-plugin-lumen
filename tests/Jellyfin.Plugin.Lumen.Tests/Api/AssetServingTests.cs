using System.IO.Compression;
using System.Net;
using System.Text;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Injection;
using MediaBrowser.Controller;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

/// <summary>GET /Lumen/Assets through ASP.NET Core's middleware in Jellyfin's order, with Jellyfin's compression defaults.</summary>
public sealed class AssetServingTests : IAsyncLifetime
{
    private static readonly byte[] Css = Encoding.UTF8.GetBytes(string.Concat(Enumerable.Range(0, 500).Select(i => $".lumen-row-{i} {{ margin: {i}px; }}\n")));
    private static readonly byte[] TinyJs = "import('./x.js');"u8.ToArray();
    private static readonly byte[] Font = [.. "wOF2"u8, .. new byte[2048]];
    private static readonly byte[] WebPlugin = Encoding.UTF8.GetBytes("window.LumenWebPlugin = function () { return function () { this.name = 'Lumen'; }; };\n" + new string(' ', 256));
    private IHost _host = null!;

    public async Task InitializeAsync()
    {
        _host = await new HostBuilder()
            .ConfigureWebHost(web => web
                .UseTestServer()
                .ConfigureServices(services =>
                {
                    services.AddSingleton(new AssetCatalog(new Dictionary<string, byte[]> { ["lumen.css"] = Css, ["lumen.js"] = TinyJs, [HtmlInjector.WebPluginAsset] = WebPlugin, ["lumen-font-inter-400-AbC.woff2"] = Font }));
                    services.AddSingleton(Substitute.For<ILumenConfigReader>());
                    services.AddSingleton(new DiagnosticsStore());
                    services.AddSingleton(TimeProvider.System);
                    services.AddSingleton(Substitute.For<IServerApplicationHost>());
                    services.AddResponseCompression();
                    services.AddControllers().ConfigureApplicationPartManager(parts =>
                    {
                        parts.ApplicationParts.Clear();
                        parts.ApplicationParts.Add(new AssemblyPart(typeof(LumenController).Assembly));
                    });
                })
                .Configure(app =>
                {
                    app.UseResponseCompression();
                    app.UseRouting();
                    app.UseEndpoints(endpoints => endpoints.MapControllers());
                }))
            .StartAsync();
    }

    public async Task DisposeAsync()
    {
        await _host.StopAsync();
        _host.Dispose();
    }

    [Theory]
    [InlineData("https://localhost", "br, gzip", "br")]
    [InlineData("http://localhost", "br, gzip", "br")]
    [InlineData("https://localhost", "gzip", "gzip")]
    [InlineData("http://localhost", "gzip;q=1, br;q=0", "gzip")]
    [InlineData("https://localhost", null, null)]
    [InlineData("http://localhost", null, null)]
    public async Task ServesThePrecompressedFile_OverHttpAndHttps(string baseAddress, string? acceptEncoding, string? encoding)
    {
        using var response = await Get(baseAddress, "/Lumen/Assets/lumen.css", acceptEncoding);
        var bytes = await response.Content.ReadAsByteArrayAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(encoding is null ? [] : [encoding], response.Content.Headers.ContentEncoding);
        Assert.Equal(bytes.Length, response.Content.Headers.ContentLength);
        Assert.Equal(Css, Decode(bytes, encoding));
        Assert.Equal(["Accept-Encoding"], response.Headers.Vary);
        Assert.EndsWith(encoding switch { "br" => "-br\"", "gzip" => "-gz\"", _ => "\"" }, response.Headers.ETag!.Tag, StringComparison.Ordinal);
        Assert.Equal("text/css; charset=utf-8", response.Content.Headers.ContentType!.ToString());
    }

    [Fact]
    public async Task ATinyFile_IsEncodedOnce_NotAgainByJellyfinsCompression()
    {
        using var response = await Get("http://localhost", "/Lumen/Assets/lumen.js", "br");

        Assert.Equal(["br"], response.Content.Headers.ContentEncoding);
        Assert.Equal(TinyJs, Decode(await response.Content.ReadAsByteArrayAsync(), "br"));
    }

    [Theory]
    [InlineData("br")]
    [InlineData("gzip")]
    [InlineData(null)]
    public async Task TheWebPluginDefiner_IsServedLikeTheOtherScripts_WhenFetchedDirectly(string? encoding)
    {
        using var response = await Get("https://localhost", "/Lumen/Assets/" + HtmlInjector.WebPluginAsset, encoding);
        var bytes = await response.Content.ReadAsByteArrayAsync();

        Assert.Equal(encoding is null ? [] : [encoding], response.Content.Headers.ContentEncoding);
        Assert.Equal(bytes.Length, response.Content.Headers.ContentLength);
        Assert.Equal(WebPlugin, Decode(bytes, encoding));
        Assert.Equal(["Accept-Encoding"], response.Headers.Vary);
        Assert.Equal("text/javascript; charset=utf-8", response.Content.Headers.ContentType!.ToString());
    }

    [Theory]
    [InlineData("br")]
    [InlineData(null)]
    public async Task Revalidation_WithTheRepresentationsETag_Is304(string? acceptEncoding)
    {
        using var first = await Get("https://localhost", "/Lumen/Assets/lumen.css", acceptEncoding);
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://localhost/Lumen/Assets/lumen.css");
        request.Headers.IfNoneMatch.Add(first.Headers.ETag!);
        if (acceptEncoding is not null)
        {
            request.Headers.TryAddWithoutValidation("Accept-Encoding", acceptEncoding);
        }

        using var second = await _host.GetTestClient().SendAsync(request);

        Assert.Equal(HttpStatusCode.NotModified, second.StatusCode);
    }

    [Fact]
    public async Task AnotherEncodingsETag_DoesNotRevalidate()
    {
        using var brotli = await Get("https://localhost", "/Lumen/Assets/lumen.css", "br");
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://localhost/Lumen/Assets/lumen.css");
        request.Headers.IfNoneMatch.Add(brotli.Headers.ETag!);

        using var identity = await _host.GetTestClient().SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, identity.StatusCode);
        Assert.Equal(Css, await identity.Content.ReadAsByteArrayAsync());
    }

    [Theory]
    [InlineData("https://localhost")]
    [InlineData("http://localhost")]
    public async Task AFont_IsSentAsItIs_NotCompressedAgainByJellyfin_AndCachedForGood(string baseAddress)
    {
        using var response = await Get(baseAddress, "/Lumen/Assets/lumen-font-inter-400-AbC.woff2", "br, gzip");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(response.Content.Headers.ContentEncoding);
        Assert.Equal(Font, await response.Content.ReadAsByteArrayAsync());
        Assert.Equal("font/woff2", response.Content.Headers.ContentType!.ToString());
        Assert.Equal("public, max-age=31536000, immutable", response.Headers.CacheControl!.ToString());
    }

    private static byte[] Decode(byte[] bytes, string? encoding)
    {
        using Stream decoder = encoding switch
        {
            "br" => new BrotliStream(new MemoryStream(bytes), CompressionMode.Decompress),
            "gzip" => new GZipStream(new MemoryStream(bytes), CompressionMode.Decompress),
            _ => new MemoryStream(bytes),
        };
        using var decoded = new MemoryStream();
        decoder.CopyTo(decoded);
        return decoded.ToArray();
    }

    private async Task<HttpResponseMessage> Get(string baseAddress, string path, string? acceptEncoding)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, baseAddress + path);
        if (acceptEncoding is not null)
        {
            request.Headers.TryAddWithoutValidation("Accept-Encoding", acceptEncoding);
        }

        return await _host.GetTestClient().SendAsync(request);
    }
}
