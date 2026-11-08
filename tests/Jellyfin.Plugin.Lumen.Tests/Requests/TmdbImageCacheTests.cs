using System.Net;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public sealed class TmdbImageCacheTests : IDisposable
{
    private readonly string _cacheDir = Path.Combine(Path.GetTempPath(), "lumen-tests-" + Guid.NewGuid().ToString("N"));
    private readonly FakeHttp _http = new();
    private readonly ILumenConfigStore _store = Substitute.For<ILumenConfigStore>();

    public TmdbImageCacheTests()
    {
        _store.Current.Returns(new PluginConfiguration());
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[1024]) };
    }

    [Theory]
    [InlineData("w780", "abc123.jpg", true)]
    [InlineData("original", "X9.png", true)]
    [InlineData("w9999", "abc.jpg", false)]
    [InlineData("w780", "../secret.jpg", false)]
    [InlineData("w780", "abc.gif", false)]
    [InlineData("w780", "a%2Fb.jpg", false)]
    public void OnlyKnownSizesAndPlainFileNamesAreAllowed(string size, string file, bool allowed) =>
        Assert.Equal(allowed, TmdbImageCache.IsAllowed(size, file));

    [Fact]
    public async Task FetchesFromTmdbOnce_ThenServesFromDisk()
    {
        var cache = Cache();

        var first = await cache.GetAsync("w780", "abc.jpg", CancellationToken.None);
        var second = await cache.GetAsync("w780", "abc.jpg", CancellationToken.None);

        Assert.Equal("https://image.tmdb.org/t/p/w780/abc.jpg", Assert.Single(_http.Requests).RequestUri!.ToString());
        Assert.Equal(first, second);
        Assert.Equal("image/jpeg", first!.ContentType);
        Assert.Equal(1024, new FileInfo(first.Path).Length);
    }

    [Fact]
    public async Task DisallowedOrMissingImages_AreNull()
    {
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.NotFound);
        var cache = Cache();

        Assert.Null(await cache.GetAsync("w780", "../x.jpg", CancellationToken.None));
        Assert.Null(await cache.GetAsync("w780", "missing.jpg", CancellationToken.None));
        Assert.Single(_http.Requests);
    }

    [Fact]
    public async Task Trim_DeletesTheOldestImagesUntilUnderTheCap()
    {
        _store.Current.Returns(new PluginConfiguration { ImageCacheMb = 1 });
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[400 * 1024]) };
        var cache = Cache();
        var paths = new List<string>();
        for (var i = 0; i < 4; i++)
        {
            paths.Add((await cache.GetAsync("w300", $"img{i}.jpg", CancellationToken.None))!.Path);
            File.SetLastWriteTimeUtc(paths[^1], new DateTime(2026, 1, 1, 0, 0, i, DateTimeKind.Utc));
        }

        cache.Trim();

        // 4 × 400 KB = 1.6 MB; trimming to 90% of 1 MB keeps the two newest.
        Assert.Equal([false, false, true, true], paths.Select(File.Exists));
    }

    public void Dispose()
    {
        _http.Dispose();
        if (Directory.Exists(_cacheDir))
        {
            Directory.Delete(_cacheDir, recursive: true);
        }
    }

    private TmdbImageCache Cache()
    {
        var paths = Substitute.For<IApplicationPaths>();
        paths.CachePath.Returns(_cacheDir);
        return new TmdbImageCache(_http.Factory, _store, paths, NullLogger<TmdbImageCache>.Instance);
    }
}
