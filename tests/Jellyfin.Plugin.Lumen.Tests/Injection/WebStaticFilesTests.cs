using System.Text;
using Jellyfin.Plugin.Lumen.Injection;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Configuration;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Injection;

public sealed class WebStaticFilesTests : IDisposable
{
    private const string Hash = "c4b2af8a2931aff1f2de";
    private const string Chunk = "/10092.5b72cb544b645e273855.chunk.js";

    private readonly string _root = Directory.CreateTempSubdirectory("lumen-webstatic").FullName;
    private readonly string _webRoot;

    public WebStaticFilesTests()
    {
        _webRoot = Path.Combine(_root, "web");
        Directory.CreateDirectory(Path.Combine(_webRoot, "themes", "dark"));
        Write("index.html", $"<head><script defer=\"defer\" src=\"main.jellyfin.bundle.js?{Hash}\"></script><script defer=\"defer\" src=\"node_modules.%40mui.material.bundle.js?{Hash}\"></script><script defer=\"defer\" src=\"serviceworker.js?{Hash}\"></script></head>");
        Write("main.jellyfin.bundle.js", "main()");
        Write("node_modules.@mui.material.bundle.js", "mui()");
        Write("serviceworker.js", "self.addEventListener()");
        Write(Chunk[1..], "chunk()");
        Write("config.json", "{}");
        Write("themes/dark/theme.css", "body{}");
        Write("MaterialIcons-Regular.08cefa1bc6566a650da7.unknownext", "?");
        Write("10092.5b72cb544b645e273855.chunk.js.LICENSE.txt", "MIT");

        // Outside the web root, with a content-hashed name.
        File.WriteAllText(Path.Combine(_root, "secret.0123456789abcdef0123.js"), "secret");
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    [Theory]
    [InlineData("10092.5b72cb544b645e273855.chunk.js")]
    [InlineData("node_modules.@mui.x-date-pickers.6abcdebd9403e77c393a.chunk.js")]
    [InlineData("73560.49e7c92878ed0bb4fad6.css")]
    [InlineData("MaterialIcons-Regular.08cefa1bc6566a650da7.woff")]
    [InlineData("favicon.bc8d51405ec040305a87.ico")]
    [InlineData("x.0123456789abcdef0123456789abcdef.js")]
    public void ContentHashedNames(string name) => Assert.True(WebStaticFiles.IsContentHashedName(name));

    [Theory]
    [InlineData("main.jellyfin.bundle.js")]
    [InlineData("runtime.bundle.js")]
    [InlineData("serviceworker.js")]
    [InlineData("index.html")]
    [InlineData("config.json")]
    [InlineData("theme.css")]
    [InlineData("1133.bundle.js")]
    [InlineData("5b72cb544b645e273855.js")]
    [InlineData("chunk.5B72CB544B645E273855.js")]
    [InlineData("chunk.5b72cb544b645e27.")]
    [InlineData("chunk.5b72cb544b645e2.js")]
    [InlineData("index-AbC123xy.js")]
    [InlineData("10092.5b72cb544b645e273855.chunk.js.LICENSE.txt")]
    [InlineData("x.0123456789abcdef0123456789abcdef0.js")]
    public void NamesWithoutAContentHash(string name) => Assert.False(WebStaticFiles.IsContentHashedName(name));

    [Fact]
    public void ParsesTheBundlesJellyfinWeb124Loads_UnescapedAndWithoutTheServiceWorker()
    {
        var html = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Injection", "Fixtures", "jellyfin-web-12.4.index.html"));

        var references = WebStaticFiles.ParseIndexReferences(html);

        Assert.Equal(Hash, references["/main.jellyfin.bundle.js"]);
        Assert.Equal(Hash, references["/runtime.bundle.js"]);
        Assert.Equal(Hash, references["/node_modules.@jellyfin.sdk.bundle.js"]);
        Assert.Equal(Hash, references["/main.jellyfin.d0fe7ebed50c35511f89.css"]);
        Assert.DoesNotContain("/serviceworker.js", references.Keys);
        Assert.DoesNotContain("/manifest.json", references.Keys);
        Assert.Equal(31, references.Count); // 29 scripts and 2 stylesheets, without serviceworker.js
    }

    [Theory]
    [InlineData("<script src=\"https://cdn.example/x.bundle.js?0123456789abcdef0123\"></script>")]
    [InlineData("<script src=\"/x.bundle.js?0123456789abcdef0123\"></script>")]
    [InlineData("<script src=\"//cdn.example/x.bundle.js?0123456789abcdef0123\"></script>")]
    [InlineData("<script src=\"../x.bundle.js?0123456789abcdef0123\"></script>")]
    [InlineData("<script src=\"%2e%2e/x.bundle.js?0123456789abcdef0123\"></script>")]
    [InlineData("<script src=\"x.bundle.js?v=1\"></script>")]
    [InlineData("<script src=\"x.bundle.js\"></script>")]
    public void IgnoresReferencesThatArentPlainRelativeQueryHashedFiles(string html) =>
        Assert.Empty(WebStaticFiles.ParseIndexReferences(html));

    [Theory]
    [InlineData(Chunk, null, false)]
    [InlineData(Chunk, "?anything", false)]
    [InlineData("/main.jellyfin.bundle.js", "?" + Hash, true)]
    [InlineData("/main.jellyfin.bundle.js", "?0000000000aff1f2de00", true)]
    [InlineData("/main.jellyfin.bundle.js", null, true)]
    [InlineData("/node_modules.@mui.material.bundle.js", "?" + Hash, true)]
    public void TheFilesLumenServes_AreFound_WhateverTheQuery(string file, string? query, bool bundle)
    {
        var files = Files();

        var found = files.Find(Request("/web" + file, query));

        Assert.NotNull(found);
        Assert.Equal(file, found.SubPath);
        Assert.Equal(Path.Combine(_webRoot, file[1..]), found.PhysicalPath);
        Assert.Equal("text/javascript", found.ContentType);
        Assert.Equal(bundle ? WebFileKind.IndexBundle : WebFileKind.ContentHashed, found.Kind);
    }

    [Fact]
    public void AContentHashedFileIndexHtmlLoadsByTheBuildHash_IsABundle()
    {
        const string Css = "main.jellyfin.d0fe7ebed50c35511f89.css";
        Write(Css, "body{}");
        Write("index.html", $"<link href=\"{Css}?{Hash}\" rel=\"stylesheet\">");

        Assert.Equal(WebFileKind.IndexBundle, Files().Find(Request("/web/" + Css, "?" + Hash))!.Kind);
    }

    [Theory]
    [InlineData("/web/serviceworker.js", "?" + Hash)]
    [InlineData("/web/index.html", null)]
    [InlineData("/web/", null)]
    [InlineData("/web", null)]
    [InlineData("/web/config.json", null)]
    [InlineData("/web/themes/dark/theme.css", null)]
    [InlineData("/web/1234.0123456789abcdef0123.chunk.js", null)]
    [InlineData("/web/MaterialIcons-Regular.08cefa1bc6566a650da7.unknownext", null)]
    [InlineData("/web/10092.5b72cb544b645e273855.chunk.js.LICENSE.txt", null)]
    [InlineData("/Items/10092.5b72cb544b645e273855.chunk.js", null)]
    [InlineData("/webx" + Chunk, null)]
    public void OtherRequests_AreNotFound(string path, string? query) => Assert.Null(Files().Find(Request(path, query)));

    [Theory]
    [InlineData("/web/../secret.0123456789abcdef0123.js")]
    [InlineData("/web/./../secret.0123456789abcdef0123.js")]
    [InlineData("/web/themes/../../secret.0123456789abcdef0123.js")]
    [InlineData("/web/..\\secret.0123456789abcdef0123.js")]
    [InlineData("/web//secret.0123456789abcdef0123.js")]
    public void PathsOutOfTheWebRoot_AreNotFound(string path) => Assert.Null(Files().Find(Request(path, null)));

    [Theory]
    [InlineData("/a.js", true)]
    [InlineData("/themes/dark/theme.css", true)]
    [InlineData("/..", false)]
    [InlineData("/a/../b.js", false)]
    [InlineData("/./a.js", false)]
    [InlineData("//etc/passwd", false)]
    [InlineData("/a\\..\\b.js", false)]
    [InlineData("/a/", false)]
    [InlineData("a.js", false)]
    public void OnlyPlainRelativePaths_ArePlain(string path, bool plain) => Assert.Equal(plain, WebStaticFiles.IsPlainPath(path));

    [Fact]
    public void AnAbsolutePathAfterTheWebPrefix_IsNotFound()
    {
        var secret = Path.Combine(_root, "secret.0123456789abcdef0123.js").Replace('\\', '/');

        Assert.Null(Files().Find(Request("/web/" + secret, null)));
    }

    [Theory]
    [InlineData("HEAD")]
    [InlineData("POST")]
    public void OnlyGet_IsFound(string method) => Assert.Null(Files().Find(Request("/web" + Chunk, null, method)));

    [Theory]
    [InlineData("Range", "bytes=0-1")]
    [InlineData("If-Range", "\"x\"")]
    [InlineData("If-Match", "\"x\"")]
    [InlineData("If-Unmodified-Since", "Tue, 15 Nov 1994 08:12:31 GMT")]
    public void RangesAndOtherPreconditions_AreNotFound(string header, string value)
    {
        var request = Request("/web" + Chunk, null);
        request.Headers[header] = value;

        Assert.Null(Files().Find(request));
    }

    [Fact]
    public void ConditionalGets_AreFound()
    {
        var request = Request("/web" + Chunk, null);
        request.Headers.IfNoneMatch = "\"x\"";
        request.Headers.IfModifiedSince = "Tue, 15 Nov 1994 08:12:31 GMT";

        Assert.NotNull(Files().Find(request));
    }

    [Theory]
    [InlineData("/jellyfin", "/jellyfin/web" + Chunk, true)]
    [InlineData("/jellyfin", "/JELLYFIN/WEB" + Chunk, true)]
    [InlineData("/jellyfin/", "/jellyfin/web" + Chunk, true)]
    [InlineData("/jellyfin", "/web" + Chunk, false)]
    [InlineData("/jellyfin", "/other/web" + Chunk, false)]
    [InlineData("", "/jellyfin/web" + Chunk, false)]
    [InlineData(null, "/web" + Chunk, true)]
    public void HonorsTheBaseUrl(string? baseUrl, string path, bool found) =>
        Assert.Equal(found, Files(baseUrl: baseUrl).Find(Request(path, null)) is not null);

    [Fact]
    public void WithoutAHostedWebClient_NothingIsFound()
    {
        Assert.False(new WebStaticFiles(null, null, NullLogger.Instance).Hosted);
        Assert.Null(new WebStaticFiles(null, null, NullLogger.Instance).Find(Request("/web" + Chunk, null)));
        Assert.Null(new WebStaticFiles(Path.Combine(_root, "missing"), null, NullLogger.Instance).Find(Request("/web" + Chunk, null)));
    }

    [Theory]
    [InlineData(false, true, null)]
    [InlineData(true, true, "/jf/web")]
    [InlineData(true, false, null)]
    public void ReadsJellyfinsWebPathAndBaseUrl(bool hostWebClient, bool exists, string? prefix)
    {
        var paths = Substitute.For<IServerApplicationPaths>();
        paths.WebPath.Returns(exists ? _webRoot : Path.Combine(_root, "missing"));
        var configuration = Substitute.For<IServerConfigurationManager>();
        configuration.ApplicationPaths.Returns(paths);
        configuration.GetConfiguration("network").Returns(new NetworkConfiguration { BaseUrl = "/jf" });
        var appConfiguration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["hostwebclient"] = hostWebClient.ToString() })
            .Build();

        using var files = new WebStaticFiles(configuration, appConfiguration, TimeProvider.System, NullLogger<WebStaticFiles>.Instance);

        Assert.Equal(prefix is not null, files.Hosted);
        Assert.Equal(prefix is not null, files.Find(Request("/jf/web" + Chunk, null)) is not null);
    }

    [Fact]
    public void ANewIndexHtml_ChangesWhichFilesAreBundles()
    {
        var files = Files();
        Assert.NotNull(files.Find(Request("/web/node_modules.@mui.material.bundle.js", "?" + Hash)));

        Write("index.html", "<script defer=\"defer\" src=\"main.jellyfin.bundle.js?1111111111aff1f2de11\"></script><!-- upgraded -->");

        Assert.Null(files.Find(Request("/web/node_modules.@mui.material.bundle.js", "?" + Hash)));
        Assert.NotNull(files.Find(Request("/web/main.jellyfin.bundle.js", "?1111111111aff1f2de11")));
    }

    [Fact]
    public async Task MakesTheCopiesInTheBackground_AndDropsThemWhenTheFileChanges()
    {
        var files = Files();
        var file = files.Find(Request("/web" + Chunk, null))!;

        Assert.Null(files.TryGetReady(file));
        await files.WhenIdleAsync();
        var ready = files.TryGetReady(file);

        Assert.NotNull(ready);
        Assert.True(ready.Asset.IsPrecompressed);
        Assert.Equal("chunk()"u8.ToArray(), ready.Asset.Content);

        Write(Chunk[1..], "chunk() // changed");
        var changed = files.Find(Request("/web" + Chunk, null))!;

        Assert.Null(files.TryGetReady(changed));
        await files.WhenIdleAsync();
        Assert.Equal("chunk() // changed"u8.ToArray(), files.TryGetReady(changed)!.Asset.Content);
    }

    [Fact]
    public async Task KeepsTheMostRecentlyUsedFiles_WithinItsCapacity()
    {
        // Every file costs 3 x its length: the file, and one "copy" per coding of the same length.
        string[] chunks = ["/1.0123456789abcdef0001.chunk.js", "/2.0123456789abcdef0002.chunk.js", "/3.0123456789abcdef0003.chunk.js"];
        foreach (var chunk in chunks)
        {
            Write(chunk[1..], new string('x', 100));
        }

        var files = Files(capacity: 700, compress: (content, _) => content);
        var found = chunks.Select(c => files.Find(Request("/web" + c, null))!).ToArray();
        await Ready(files, found[0]);
        await Ready(files, found[1]);
        Assert.NotNull(files.TryGetReady(found[0]));
        await Ready(files, found[2]);

        Assert.Equal(600, files.SizeBytes);
        Assert.NotNull(files.TryGetReady(found[0]));
        Assert.NotNull(files.TryGetReady(found[2]));
        Assert.Null(files.TryGetReady(found[1]));
    }

    [Fact]
    public async Task AFileBiggerThanTheCapacity_IsNeverHeld_AndDoesntPushOutTheOthers()
    {
        Write("1.0123456789abcdef0001.chunk.js", new string('x', 10));
        Write("2.0123456789abcdef0002.chunk.js", new string('x', 100));
        var files = Files(capacity: 100, compress: (content, _) => content);
        var small = files.Find(Request("/web/1.0123456789abcdef0001.chunk.js", null))!;
        var big = files.Find(Request("/web/2.0123456789abcdef0002.chunk.js", null))!;
        await Ready(files, small);

        await Ready(files, big, expectReady: false);

        Assert.Equal(30, files.SizeBytes);
        Assert.NotNull(files.TryGetReady(small));
    }

    [Fact]
    public async Task ATransformedFile_IsDroppedAndRemembered_UntilItChanges()
    {
        var files = Files();
        var file = files.Find(Request("/web" + Chunk, null))!;
        await Ready(files, file);

        files.MarkTransformed(file);

        Assert.True(files.IsTransformed(file));
        Assert.Equal(0, files.SizeBytes);
        Write(Chunk[1..], "chunk() // a new version");
        Assert.False(files.IsTransformed(files.Find(Request("/web" + Chunk, null))!));
    }

    [Fact]
    public async Task Warmup_QueuesTheFilesIndexHtmlLoads_ButNotTheServiceWorker()
    {
        var files = Files();

        await files.StartWarmup(() => true);
        await files.WhenIdleAsync();

        Assert.NotNull(files.TryGetReady(files.Find(Request("/web/main.jellyfin.bundle.js", "?" + Hash))!));
        Assert.NotNull(files.TryGetReady(files.Find(Request("/web/node_modules.@mui.material.bundle.js", "?" + Hash))!));
        Assert.True(files.SizeBytes > 0);
    }

    [Fact]
    public async Task Warmup_DoesNothingWhenSwitchedOff()
    {
        var files = Files();

        await files.StartWarmup(() => false);
        await files.WhenIdleAsync();

        Assert.Equal(0, files.SizeBytes);
    }

    [Fact]
    public async Task AFileChangedWhileItWasRead_IsNotKept()
    {
        var files = Files();
        var file = files.Find(Request("/web" + Chunk, null))!;
        files.AfterRead = _ => Write(Chunk[1..], "chunk() // rewritten while read");

        Assert.Null(files.TryGetReady(file));
        await files.WhenIdleAsync();
        files.AfterRead = null;

        Assert.Equal(0, files.SizeBytes);
        var changed = files.Find(Request("/web" + Chunk, null))!;
        await Ready(files, changed);
        Assert.Equal("chunk() // rewritten while read"u8.ToArray(), files.TryGetReady(changed)!.Asset.Content);
    }

    [Theory]
    [InlineData("12394.ee3d55fe627e7f25f96a.chunk.js")]
    [InlineData("39469.ecb9e7873ce7fbb4c4db.chunk.js")]
    public void JellyfinWebsContentHashes_MatchTheirFiles(string name)
    {
        var content = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Injection", "Fixtures", "jellyfin-web-12.4", name));

        Assert.True(WebStaticFiles.HashMatchesContent(name, content));
    }

    [Fact]
    public void AHashThatAppearsInItsFile_IsLeftOutOfTheHash()
    {
        // This one's license comment names the file, so its hash is in it; webpack hashes the file without it.
        const string Name = "39469.ecb9e7873ce7fbb4c4db.chunk.js";
        var content = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Injection", "Fixtures", "jellyfin-web-12.4", Name));

        Assert.Contains("ecb9e7873ce7fbb4c4db", Encoding.ASCII.GetString(content), StringComparison.Ordinal);
        Assert.NotEqual("ecb9e7873ce7fbb4c4db", Convert.ToHexStringLower(Md4.Hash(content))[..20]);
        Assert.True(WebStaticFiles.HashMatchesContent(Name, content));
    }

    [Theory]
    [InlineData("12394.ee3d55fe627e7f25f96b.chunk.js")]
    [InlineData("12394.ee3d55fe627e7f25f96a.chunk.js.LICENSE.txt")]
    [InlineData("12394.chunk.js")]
    public void OtherNames_DontMatch(string name)
    {
        var content = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Injection", "Fixtures", "jellyfin-web-12.4", "12394.ee3d55fe627e7f25f96a.chunk.js"));

        Assert.False(WebStaticFiles.HashMatchesContent(name, content));
    }

    [Fact]
    public void APatchedFile_DoesntMatchItsName()
    {
        const string Name = "12394.ee3d55fe627e7f25f96a.chunk.js";
        var content = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Injection", "Fixtures", "jellyfin-web-12.4", Name));

        Assert.False(WebStaticFiles.HashMatchesContent(Name, [.. content, .. "/* patched */"u8]));
    }

    [Fact]
    public async Task TheHashCheck_IsMadeWithTheCopies()
    {
        var content = "export const x = 1;"u8.ToArray();
        var verified = "/x." + Convert.ToHexStringLower(Md4.Hash(content))[..20] + ".chunk.js";
        File.WriteAllBytes(Path.Combine(_webRoot, verified[1..]), content);
        var files = Files();

        var good = files.Find(Request("/web" + verified, null))!;
        var bad = files.Find(Request("/web" + Chunk, null))!;
        await Ready(files, good);
        await Ready(files, bad);

        Assert.True(files.TryGetReady(good)!.HashMatches);
        Assert.False(files.TryGetReady(bad)!.HashMatches);
    }

    [Fact]
    public void CacheControl_IsAWeekForAMatchingHash_NoCacheForBundles_ElseJellyfins()
    {
        var files = Files();
        var chunk = files.Find(Request("/web" + Chunk, null))!;
        var bundle = files.Find(Request("/web/main.jellyfin.bundle.js", "?" + Hash))!;

        Assert.Equal(WebStaticFiles.WeekCacheControl, files.CacheControlFor(chunk, hashMatches: true));
        Assert.Null(files.CacheControlFor(chunk, hashMatches: false));
        Assert.Equal(WebStaticFiles.NoCacheControl, files.CacheControlFor(bundle, hashMatches: true));
        Assert.Equal(WebStaticFiles.NoCacheControl, files.CacheControlFor(bundle, hashMatches: false));
    }

    [Fact]
    public void WithFileTransformationLoaded_NothingGetsALifetime()
    {
        var files = Files(fileTransformation: Watch(loaded: true));
        var chunk = files.Find(Request("/web" + Chunk, null))!;
        var bundle = files.Find(Request("/web/main.jellyfin.bundle.js", "?" + Hash))!;

        Assert.Null(files.CacheControlFor(chunk, hashMatches: true));
        Assert.Equal(WebStaticFiles.NoCacheControl, files.CacheControlFor(bundle, hashMatches: true));
    }

    [Fact]
    public void ReadsJellyfinsWebPathAndBaseUrl_AndLooksForFileTransformation()
    {
        var paths = Substitute.For<IServerApplicationPaths>();
        paths.WebPath.Returns(_webRoot);
        var configuration = Substitute.For<IServerConfigurationManager>();
        configuration.ApplicationPaths.Returns(paths);
        var appConfiguration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["hostwebclient"] = "true" }).Build();

        using var files = new WebStaticFiles(configuration, appConfiguration, TimeProvider.System, NullLogger<WebStaticFiles>.Instance);

        // No File Transformation in the test run: the real lookup finds none.
        Assert.Equal(WebStaticFiles.WeekCacheControl, files.CacheControlFor(files.Find(Request("/web" + Chunk, null))!, hashMatches: true));
    }

    private static async Task Ready(WebStaticFiles files, WebFile file, bool expectReady = true)
    {
        _ = files.TryGetReady(file);
        await files.WhenIdleAsync();
        Assert.Equal(expectReady, files.TryGetReady(file) is not null);
        await files.WhenIdleAsync();
    }

    private static HttpRequest Request(string path, string? query, string method = "GET")
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        if (query is not null)
        {
            context.Request.QueryString = new QueryString(query);
        }

        return context.Request;
    }

    /// <summary>A real lookup, for an assembly that is loaded (Lumen's) or isn't (File Transformation's).</summary>
    private static AssemblyWatch Watch(bool loaded) =>
        new(loaded ? typeof(WebStaticFiles).Assembly.GetName().Name! : WebStaticFiles.FileTransformationAssembly, TimeProvider.System);

    private WebStaticFiles Files(
        string? baseUrl = null,
        long capacity = WebStaticFiles.DefaultCapacityBytes,
        Func<byte[], string, byte[]>? compress = null,
        AssemblyWatch? fileTransformation = null) =>
        new(_webRoot, baseUrl, NullLogger.Instance, fileTransformation, capacity, compress);

    private void Write(string relative, string content)
    {
        var path = Path.Combine(_webRoot, relative);
        var before = File.Exists(path) ? File.GetLastWriteTimeUtc(path) : DateTime.MinValue;
        File.WriteAllText(path, content, new UTF8Encoding(false));

        // A file rewritten within the clock's resolution would keep its stamp if its length didn't change.
        if (File.GetLastWriteTimeUtc(path) <= before)
        {
            File.SetLastWriteTimeUtc(path, before.AddSeconds(1));
        }
    }
}
