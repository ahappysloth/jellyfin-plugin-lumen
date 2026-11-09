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
        // Fill under a roomy cap (no automatic trims), then lower it, as an admin would.
        _store.Current.Returns(new PluginConfiguration { ImageCacheMb = 100 });
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[400 * 1024]) };
        var cache = Cache();
        var paths = new List<string>();
        for (var i = 0; i < 4; i++)
        {
            paths.Add((await cache.GetAsync("w300", $"img{i}.jpg", CancellationToken.None))!.Path);
            File.SetLastWriteTimeUtc(paths[^1], new DateTime(2026, 1, 1, 0, 0, i, DateTimeKind.Utc));
        }

        await Task.Delay(100); // let the once-per-process startup trim finish
        _store.Current.Returns(new PluginConfiguration { ImageCacheMb = 1 });
        cache.Trim();

        // 4 × 400 KB = 1.6 MB; trimming to 90% of 1 MB keeps the two newest.
        Assert.Equal([false, false, true, true], paths.Select(File.Exists));
    }

    [Fact]
    public async Task AnInterruptedDownload_LeavesNoTempFile()
    {
        _store.Current.Returns(new PluginConfiguration { ImageCacheMb = 100 });
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new FailingStream()) };

        await Assert.ThrowsAnyAsync<HttpRequestException>(() => Cache().GetAsync("w300", "broken.jpg", CancellationToken.None));

        Assert.Empty(Directory.EnumerateFiles(_cacheDir, "*", SearchOption.AllDirectories));
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

    /// <summary>A response body whose connection drops after the first chunk.</summary>
    private sealed class FailingStream : MemoryStream
    {
        private bool _sent;

        public FailingStream()
            : base(new byte[64])
        {
        }

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            if (_sent)
            {
                throw new IOException("connection reset");
            }

            _sent = true;
            return base.ReadAsync(buffer, cancellationToken);
        }

        public override int Read(byte[] buffer, int offset, int count) => _sent ? throw new IOException("connection reset") : SentRead(buffer, offset, count);

        private int SentRead(byte[] buffer, int offset, int count)
        {
            _sent = true;
            return base.Read(buffer, offset, count);
        }
    }
}
