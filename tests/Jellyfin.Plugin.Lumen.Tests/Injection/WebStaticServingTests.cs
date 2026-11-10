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
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Primitives;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Injection;

/// <summary>
/// jellyfin-web's files through Lumen's middleware and ASP.NET Core's in Jellyfin's order (Startup.cs): the plugin's
/// middleware, then Map(BaseUrl), response compression with Jellyfin's defaults, and the static files for /web.
/// </summary>
public sealed class WebStaticServingTests : IDisposable
{
    private const string Hash = "c4b2af8a2931aff1f2de";
    private const string Bundle = "/web/main.jellyfin.bundle.js?" + Hash;

    private static readonly byte[] ChunkJs = Encoding.UTF8.GetBytes(string.Concat(Enumerable.Range(0, 400).Select(i => $"export function f{i}() {{ return {i}; }}\n")));
    private static readonly byte[] MainJs = Encoding.UTF8.GetBytes(string.Concat(Enumerable.Range(0, 400).Select(i => $"window.main{i} = {i};\n")));
    private static readonly byte[] Woff2 = [.. Enumerable.Range(0, 2000).Select(i => (byte)(i * 7))];
    private static readonly byte[] Wasm = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, .. Enumerable.Repeat((byte)0, 4000)];

    /// <summary>Named with webpack's content hash of its bytes.</summary>
    private static readonly string Chunk = "/web/" + Named("10092", ChunkJs, ".chunk.js");

    /// <summary>Named like a content-hashed file, with a hash that isn't its own (patched on disk).</summary>
    private static readonly string Patched = "/web/10093.0123456789abcdef0123.chunk.js";

    private static readonly string Font = "/web/" + Named("MaterialIcons-Regular", Woff2, ".woff2");
    private static readonly string WasmFile = "/web/" + Named("libbitsub_bg", Wasm, ".wasm");

    private readonly string _webRoot = Directory.CreateTempSubdirectory("lumen-webstatic").FullName;
    private readonly List<long?> _sentLengths = [];
    private readonly List<(StringValues AcceptEncoding, StringValues IfNoneMatch, StringValues IfModifiedSince)> _requestHeadersAfter = [];
    private PluginConfiguration _config = new();
    private bool _fileTransformationLoaded;

    public WebStaticServingTests()
    {
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), $"<!doctype html><html><head><script defer=\"defer\" src=\"main.jellyfin.bundle.js?{Hash}\"></script><script defer=\"defer\" src=\"serviceworker.js?{Hash}\"></script></head><body></body></html>");
        File.WriteAllBytes(Path.Combine(_webRoot, "main.jellyfin.bundle.js"), MainJs);
        File.WriteAllBytes(Path.Combine(_webRoot, Chunk["/web/".Length..]), ChunkJs);
        File.WriteAllBytes(Path.Combine(_webRoot, Patched["/web/".Length..]), ChunkJs);
        File.WriteAllBytes(Path.Combine(_webRoot, Font["/web/".Length..]), Woff2);
        File.WriteAllBytes(Path.Combine(_webRoot, WasmFile["/web/".Length..]), Wasm);
        File.WriteAllBytes(Path.Combine(_webRoot, Chunk["/web/".Length..] + ".LICENSE.txt"), ChunkJs);
        File.WriteAllBytes(Path.Combine(_webRoot, "serviceworker.js"), MainJs);
        File.WriteAllText(Path.Combine(_webRoot, "config.json"), "{\"plugins\":[]}");
        Directory.CreateDirectory(Path.Combine(_webRoot, "themes", "dark"));
        File.WriteAllBytes(Path.Combine(_webRoot, "themes", "dark", "theme.css"), ChunkJs);
    }

    public void Dispose() => Directory.Delete(_webRoot, recursive: true);

    [Fact]
    public async Task TheFirstRequest_GoesToJellyfin_AndQueuesTheCopies()
    {
        using var host = await StartAsync();

        using var first = await Get(host, Chunk, "br, gzip", "http://localhost");

        Assert.Null(first.Headers.CacheControl);
        Assert.Equal(ChunkJs, await Body(first));
        await host.Services.GetRequiredService<WebStaticFiles>().WhenIdleAsync();
        using var second = await Get(host, Chunk, "br, gzip");
        Assert.Equal(WebStaticFiles.WeekCacheControl, second.Headers.CacheControl!.ToString());
    }

    [Theory]
    [InlineData("https://localhost", "br, gzip", "br")]
    [InlineData("http://localhost", "br, gzip", "br")]
    [InlineData("http://localhost", "gzip, deflate", "gzip")]
    [InlineData("https://localhost", "gzip;q=1, br;q=0", "gzip")]
    [InlineData("https://localhost", null, null)]
    [InlineData("http://localhost", "identity", null)]
    public async Task AFileWhoseHashChecksOut_IsServedPrecompressed_ForAWeek(string baseAddress, string? acceptEncoding, string? encoding)
    {
        using var host = await StartReadyAsync(Chunk);

        using var response = await Get(host, Chunk, acceptEncoding, baseAddress);
        var bytes = await response.Content.ReadAsByteArrayAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(WebStaticFiles.WeekCacheControl, response.Headers.CacheControl!.ToString());
        Assert.Equal(encoding is null ? [] : [encoding], response.Content.Headers.ContentEncoding);
        Assert.Equal(bytes.Length, _sentLengths[^1]);
        Assert.Equal(ChunkJs, Decode(bytes, encoding));
        Assert.Equal(["Accept-Encoding"], response.Headers.Vary);
        Assert.EndsWith(encoding switch { "br" => "-br\"", "gzip" => "-gz\"", _ => "\"" }, response.Headers.ETag!.Tag, StringComparison.Ordinal);
        Assert.Equal("text/javascript", response.Content.Headers.ContentType!.ToString());
        Assert.NotNull(response.Content.Headers.LastModified);
        Assert.False(response.Headers.Contains("Accept-Ranges"));
    }

    [Fact]
    public async Task TheBrotliCopy_IsLumensBestQualityCopy()
    {
        using var host = await StartReadyAsync(Chunk);

        using var response = await Get(host, Chunk, "br");

        var reference = new LumenAsset("x", ChunkJs, "text/javascript");
        Assert.Equal(reference.Select("br").Content, await response.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task AFileWhoseHashDoesntCheckOut_IsCompressed_ButKeepsJellyfinsCaching()
    {
        using var host = await StartReadyAsync(Patched);

        using var response = await Get(host, Patched, "br");

        Assert.Null(response.Headers.CacheControl);
        Assert.NotNull(response.Content.Headers.LastModified);
        Assert.EndsWith("-br\"", response.Headers.ETag!.Tag, StringComparison.Ordinal);
        Assert.Equal(new LumenAsset("x", ChunkJs, "text/javascript").Select("br").Content, await response.Content.ReadAsByteArrayAsync());
    }

    [Theory]
    [InlineData(Bundle)]
    [InlineData("/web/main.jellyfin.bundle.js?0000000000aff1f2de00")]
    [InlineData("/web/main.jellyfin.bundle.js")]
    public async Task TheBundlesIndexHtmlLoads_AreServedPrecompressed_AndRevalidatedEveryTime(string path)
    {
        using var host = await StartReadyAsync(Bundle);

        using var response = await Get(host, path, "br");

        Assert.Equal(WebStaticFiles.NoCacheControl, response.Headers.CacheControl!.ToString());
        Assert.EndsWith("-br\"", response.Headers.ETag!.Tag, StringComparison.Ordinal);
        Assert.Equal(MainJs, Decode(await response.Content.ReadAsByteArrayAsync(), "br"));
    }

    [Fact]
    public async Task WithFileTransformationLoaded_NothingGetsALifetime()
    {
        _fileTransformationLoaded = true;
        using var host = await StartReadyAsync(Chunk);
        (await Get(host, Bundle, "br")).Dispose();
        await host.Services.GetRequiredService<WebStaticFiles>().WhenIdleAsync();

        using var chunk = await Get(host, Chunk, "br");
        using var bundle = await Get(host, Bundle, "br");

        Assert.Null(chunk.Headers.CacheControl);
        Assert.EndsWith("-br\"", chunk.Headers.ETag!.Tag, StringComparison.Ordinal);
        Assert.Equal(WebStaticFiles.NoCacheControl, bundle.Headers.CacheControl!.ToString());
    }

    [Theory]
    [InlineData("br")]
    [InlineData("gzip")]
    [InlineData(null)]
    public async Task Revalidation_WithTheRepresentationsETag_Is304(string? acceptEncoding)
    {
        using var host = await StartReadyAsync(Bundle);
        using var first = await Get(host, Bundle, acceptEncoding);

        using var second = await Get(host, Bundle, acceptEncoding, ifNoneMatch: first.Headers.ETag!.ToString());

        Assert.Equal(HttpStatusCode.NotModified, second.StatusCode);
        Assert.Empty(await second.Content.ReadAsByteArrayAsync());
        Assert.Equal(first.Headers.ETag, second.Headers.ETag);
        Assert.Equal(WebStaticFiles.NoCacheControl, second.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task AnotherEncodingsETag_DoesNotRevalidate()
    {
        using var host = await StartReadyAsync(Chunk);
        using var brotli = await Get(host, Chunk, "br");

        using var gzip = await Get(host, Chunk, "gzip", ifNoneMatch: brotli.Headers.ETag!.ToString());

        Assert.Equal(HttpStatusCode.OK, gzip.StatusCode);
        Assert.Equal(ChunkJs, Decode(await gzip.Content.ReadAsByteArrayAsync(), "gzip"));
    }

    [Fact]
    public async Task JellyfinsOwnETag_DoesNotRevalidate_SoNoClientKeepsJellyfinsFastestEncodingAsLumens()
    {
        using var host = await StartAsync();
        using var stock = await Get(host, Chunk, "br");
        await host.Services.GetRequiredService<WebStaticFiles>().WhenIdleAsync();

        using var response = await Get(host, Chunk, "br", ifNoneMatch: stock.Headers.ETag!.ToString());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(ChunkJs, Decode(await response.Content.ReadAsByteArrayAsync(), "br"));
    }

    [Theory]
    [InlineData(1, HttpStatusCode.NotModified)]
    [InlineData(-1, HttpStatusCode.OK)]
    public async Task IfModifiedSince_IsAnsweredByLumen_WithItsOwnHeaders(int days, HttpStatusCode status)
    {
        // Two days old, so the date asked about is in the past, where Jellyfin would answer it itself.
        var path = Path.Combine(_webRoot, "main.jellyfin.bundle.js");
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddDays(-2));
        using var host = await StartReadyAsync(Bundle);
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://localhost" + Bundle);
        request.Headers.IfModifiedSince = File.GetLastWriteTimeUtc(path).AddDays(days);
        request.Headers.TryAddWithoutValidation("Accept-Encoding", "br");

        using var response = await host.GetTestClient().SendAsync(request);

        Assert.Equal(status, response.StatusCode);
        Assert.Equal(WebStaticFiles.NoCacheControl, response.Headers.CacheControl!.ToString());
        Assert.EndsWith("-br\"", response.Headers.ETag!.Tag, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheClientsHeaders_ArePutBack_ForTheMiddlewareAroundLumens()
    {
        using var host = await StartReadyAsync(Chunk);
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://localhost" + Chunk);
        request.Headers.TryAddWithoutValidation("Accept-Encoding", "br");
        request.Headers.TryAddWithoutValidation("If-None-Match", "\"other\"");
        request.Headers.TryAddWithoutValidation("If-Modified-Since", "Tue, 15 Nov 1994 08:12:31 GMT");

        using var response = await host.GetTestClient().SendAsync(request);

        var (acceptEncoding, ifNoneMatch, ifModifiedSince) = _requestHeadersAfter[^1];
        Assert.Equal("br", acceptEncoding.ToString());
        Assert.Equal("\"other\"", ifNoneMatch.ToString());
        Assert.Equal("Tue, 15 Nov 1994 08:12:31 GMT", ifModifiedSince.ToString());
    }

    [Fact]
    public async Task AnUncompressedFont_IsKeptForAWeek_AsItIs()
    {
        using var host = await StartReadyAsync(Font);

        using var response = await Get(host, Font, "br, gzip");

        Assert.Equal(WebStaticFiles.WeekCacheControl, response.Headers.CacheControl!.ToString());
        Assert.Empty(response.Content.Headers.ContentEncoding);
        Assert.Empty(response.Headers.Vary);
        Assert.Equal(Woff2, await response.Content.ReadAsByteArrayAsync());
        Assert.Equal("font/woff2", response.Content.Headers.ContentType!.ToString());
    }

    [Fact]
    public async Task WebAssembly_IsCompressed()
    {
        using var host = await StartReadyAsync(WasmFile);

        using var response = await Get(host, WasmFile, "br");
        var bytes = await response.Content.ReadAsByteArrayAsync();

        Assert.Equal(["br"], response.Content.Headers.ContentEncoding);
        Assert.Equal(Wasm, Decode(bytes, "br"));
        Assert.True(bytes.Length < Wasm.Length / 10);
    }

    [Theory]
    [InlineData("/web/serviceworker.js?" + Hash)]
    [InlineData("/web/themes/dark/theme.css")]
    public async Task OtherFiles_AreServedAsJellyfinServesThem(string path)
    {
        using var host = await StartReadyAsync(Bundle);
        await Get(host, path, "br");
        await host.Services.GetRequiredService<WebStaticFiles>().WhenIdleAsync();

        using var response = await Get(host, path, "br", "http://localhost");

        Assert.Null(response.Headers.CacheControl);
        Assert.NotNull(response.Content.Headers.LastModified);
        Assert.Equal(["br"], response.Content.Headers.ContentEncoding);
        Assert.DoesNotContain("-br\"", response.Headers.ETag!.Tag, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ALicenseFile_IsServedAsJellyfinServesIt()
    {
        var license = Chunk + ".LICENSE.txt";
        using var host = await StartReadyAsync(license);

        using var response = await Get(host, license, "br", "http://localhost");

        Assert.Null(response.Headers.CacheControl);
        Assert.DoesNotContain("-br\"", response.Headers.ETag!.Tag, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("/web/index.html")]
    [InlineData("/web/")]
    [InlineData("/web/config.json")]
    public async Task IndexHtmlAndConfigJson_AreLeftToTheirOwnHandling(string path)
    {
        using var host = await StartReadyAsync(Chunk);

        using var response = await Get(host, path, null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotEqual(WebStaticFiles.WeekCacheControl, response.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task Head_IsLeftToJellyfin()
    {
        using var host = await StartReadyAsync(Chunk);
        using var request = new HttpRequestMessage(HttpMethod.Head, "https://localhost" + Chunk);

        using var response = await host.GetTestClient().SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Null(response.Headers.CacheControl);
        Assert.Equal(ChunkJs.Length, response.Content.Headers.ContentLength);
    }

    [Fact]
    public async Task Range_IsLeftToJellyfin()
    {
        using var host = await StartReadyAsync(Chunk);
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://localhost" + Chunk);
        request.Headers.Range = new RangeHeaderValue(0, 9);
        request.Headers.TryAddWithoutValidation("Accept-Encoding", "br");

        using var response = await host.GetTestClient().SendAsync(request);

        Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
        Assert.Equal(ChunkJs[..10], await response.Content.ReadAsByteArrayAsync());
        Assert.Null(response.Headers.CacheControl);
    }

    [Fact]
    public async Task SwitchedOff_EverythingIsLeftToJellyfin()
    {
        using var host = await StartReadyAsync(Chunk);
        _config = new PluginConfiguration { OptimizeWebClientFiles = false };

        using var response = await Get(host, Chunk, "br", "http://localhost");

        Assert.Null(response.Headers.CacheControl);
        Assert.DoesNotContain("-br\"", response.Headers.ETag!.Tag, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UnderABaseUrl_TheFilesThereAreServed()
    {
        using var host = await StartAsync(baseUrl: "/jellyfin");
        using var first = await Get(host, "/jellyfin" + Chunk, "br");
        await host.Services.GetRequiredService<WebStaticFiles>().WhenIdleAsync();

        using var served = await Get(host, "/jellyfin" + Chunk, "br");
        using var outside = await Get(host, Chunk, "br");

        Assert.Equal(WebStaticFiles.WeekCacheControl, served.Headers.CacheControl!.ToString());
        Assert.Equal(ChunkJs, Decode(await served.Content.ReadAsByteArrayAsync(), "br"));
        Assert.Null(outside.Headers.CacheControl);
    }

    [Fact]
    public async Task WhatJellyfinsPipelineAdds_IsKept()
    {
        using var host = await StartReadyAsync(Chunk, inner: app => app.Use(async (context, next) =>
        {
            context.Response.Headers["Access-Control-Allow-Origin"] = "*";
            await next(context);
        }));

        using var response = await Get(host, Chunk, "br");

        Assert.Equal(WebStaticFiles.WeekCacheControl, response.Headers.CacheControl!.ToString());
        Assert.Equal("*", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Theory]
    [InlineData("replace")]
    [InlineData("append")]
    [InlineData("truncate")]
    public async Task AFileAnotherPluginRewrites_IsLeftToJellyfin_FromThenOn(string change)
    {
        // Appended to or cut short, the response matches the file until the change.
        var body = change switch
        {
            "append" => [.. ChunkJs, .. "\n/* patched */"u8],
            "truncate" => ChunkJs[..(ChunkJs.Length - 100)],
            _ => "rewritten();"u8.ToArray(),
        };
        var rewrite = false;
        using var host = await StartReadyAsync(Chunk, inner: app => app.Use(async (context, next) =>
        {
            if (!rewrite)
            {
                await next(context);
                return;
            }

            context.Response.ContentType = "text/javascript";
            context.Response.ContentLength = body.Length;
            await context.Response.Body.WriteAsync(body.AsMemory(0, body.Length / 2));
            await context.Response.Body.WriteAsync(body.AsMemory(body.Length / 2));
        }));
        rewrite = true;

        using var rewritten = await Get(host, Chunk, "br");
        Assert.Equal(body, await rewritten.Content.ReadAsByteArrayAsync());
        Assert.Null(rewritten.Headers.CacheControl);

        rewrite = false;
        using var after = await Get(host, Chunk, "br", "http://localhost");
        Assert.Null(after.Headers.CacheControl);
        Assert.NotNull(after.Content.Headers.LastModified);
        Assert.Equal(ChunkJs, Decode(await after.Content.ReadAsByteArrayAsync(), "br"));
    }

    [Theory]
    [InlineData(StatusCodes.Status307TemporaryRedirect)]
    [InlineData(StatusCodes.Status203NonAuthoritative)]
    public async Task AnotherStatusFromJellyfin_IsPassedOn_EvenWithTheFilesBytes(int status)
    {
        var redirect = false;
        using var host = await StartReadyAsync(Chunk, inner: app => app.Use(async (context, next) =>
        {
            if (!redirect)
            {
                await next(context);
                return;
            }

            context.Response.StatusCode = status;
            await context.Response.Body.WriteAsync(ChunkJs);
        }));
        redirect = true;

        using var response = await Get(host, Chunk, "br", "http://localhost");
        redirect = false;
        using var after = await Get(host, Chunk, "br");

        Assert.Equal(status, (int)response.StatusCode);
        Assert.Null(response.Headers.CacheControl);
        Assert.Equal(ChunkJs, await response.Content.ReadAsByteArrayAsync());
        Assert.Equal(WebStaticFiles.WeekCacheControl, after.Headers.CacheControl!.ToString());
    }

    private static string Named(string name, byte[] content, string extension) =>
        name + "." + Convert.ToHexStringLower(Md4.Hash(content))[..20] + extension;

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

    private static async Task<byte[]> Body(HttpResponseMessage response) =>
        Decode(await response.Content.ReadAsByteArrayAsync(), response.Content.Headers.ContentEncoding.SingleOrDefault());

    private static async Task<HttpResponseMessage> Get(IHost host, string path, string? acceptEncoding, string baseAddress = "https://localhost", string? ifNoneMatch = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, baseAddress + path);
        if (acceptEncoding is not null)
        {
            request.Headers.TryAddWithoutValidation("Accept-Encoding", acceptEncoding);
        }

        if (ifNoneMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-None-Match", ifNoneMatch);
        }

        return await host.GetTestClient().SendAsync(request);
    }

    /// <summary>A host whose copies of <paramref name="path"/> are made.</summary>
    private async Task<IHost> StartReadyAsync(string path, Action<IApplicationBuilder>? inner = null)
    {
        var host = await StartAsync(inner: inner);
        (await Get(host, path, "br")).Dispose();
        await host.Services.GetRequiredService<WebStaticFiles>().WhenIdleAsync();
        return host;
    }

    private async Task<IHost> StartAsync(string? baseUrl = null, Action<IApplicationBuilder>? inner = null)
    {
        var config = Substitute.For<ILumenConfigReader>();
        config.Current.Returns(_ => _config);
        var fileTransformation = new AssemblyWatch(
            _fileTransformationLoaded ? typeof(WebStaticFiles).Assembly.GetName().Name! : WebStaticFiles.FileTransformationAssembly,
            TimeProvider.System);
        var host = new HostBuilder()
            .ConfigureWebHost(web => web
                .UseTestServer()
                .ConfigureServices(services =>
                {
                    services.AddSingleton(config);
                    services.AddSingleton(new AssetCatalog(new Dictionary<string, byte[]>()));
                    services.AddSingleton(new WebStaticFiles(_webRoot, baseUrl, NullLogger.Instance, fileTransformation));
                    services.AddResponseCompression();
                })
                .Configure(app =>
                {
                    // What the server is told to send (TestServer's client doesn't check it against the body), and the
                    // request as the middleware around Lumen's sees it afterwards.
                    app.Use(async (context, next) =>
                    {
                        await next(context);
                        _sentLengths.Add(context.Response.ContentLength);
                        var headers = context.Request.Headers;
                        _requestHeadersAfter.Add((headers.AcceptEncoding, headers.IfNoneMatch, headers.IfModifiedSince));
                    });
                    app.UseMiddleware<IndexHtmlMiddleware>();
                    app.UseMiddleware<WebStaticMiddleware>();
                    app.Map(baseUrl ?? string.Empty, main =>
                    {
                        inner?.Invoke(main);
                        main.UseResponseCompression();
                        var files = new PhysicalFileProvider(_webRoot);
                        main.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files, RequestPath = "/web" });
                        main.UseStaticFiles(new StaticFileOptions { FileProvider = files, RequestPath = "/web" });
                    });
                }))
            .Build();
        await host.StartAsync();
        return host;
    }
}
