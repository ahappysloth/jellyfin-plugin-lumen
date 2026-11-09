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

        await Assert.ThrowsAnyAsync<IOException>(() => Cache().GetAsync("w300", "broken.jpg", CancellationToken.None));

        Assert.Empty(Directory.EnumerateFiles(_cacheDir, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task ConcurrentMisses_ShareOneDownload()
    {
        using var release = new ManualResetEventSlim();
        var calls = 0;
        _http.Respond = _ =>
        {
            Interlocked.Increment(ref calls);
            release.Wait(TimeSpan.FromSeconds(5));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[1024]) };
        };
        var cache = Cache();

        var waiting = Enumerable.Range(0, 5).Select(_ => Task.Run(() => cache.GetAsync("w780", "shared.jpg", CancellationToken.None))).ToList();
        await Task.Delay(200);
        release.Set();
        var images = await Task.WhenAll(waiting);

        Assert.Equal(1, calls);
        Assert.All(images, i => Assert.Equal(images[0], i));
        Assert.True(File.Exists(images[0]!.Path));
    }

    [Fact]
    public async Task ACancelledCaller_DoesntCancelTheSharedDownload()
    {
        using var release = new ManualResetEventSlim();
        _http.Respond = _ =>
        {
            release.Wait(TimeSpan.FromSeconds(5));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[16]) };
        };
        var cache = Cache();
        using var impatient = new CancellationTokenSource();

        var first = cache.GetAsync("w780", "patient.jpg", impatient.Token);
        var second = cache.GetAsync("w780", "patient.jpg", CancellationToken.None);
        await impatient.CancelAsync();
        release.Set();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        Assert.NotNull(await second);
    }

    [Theory]
    [InlineData(100, true)]
    [InlineData(101, false)]
    public async Task TheSizeCap_HoldsEvenWithoutAContentLength(int size, bool cached)
    {
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new UnsizedContent(size) };
        var cache = new TmdbImageCache(_http.Factory, _store, Paths(), NullLogger<TmdbImageCache>.Instance) { MaxImageBytes = 100 };

        var image = await cache.GetAsync("w300", "big.jpg", CancellationToken.None);

        Assert.Equal(cached, image is not null);
        Assert.Equal(cached ? 1 : 0, Directory.Exists(_cacheDir) ? Directory.EnumerateFiles(_cacheDir, "*", SearchOption.AllDirectories).Count() : 0);
    }

    [Fact]
    public void Trim_SkipsAFileItCantDelete_AndCarriesOn()
    {
        if (OperatingSystem.IsWindows())
        {
            return; // uses Unix directory permissions to make a file undeletable
        }

        _store.Current.Returns(new PluginConfiguration { ImageCacheMb = 1 });
        var locked = Path.Combine(_cacheDir, "lumen-tmdb", "w300");
        var open = Path.Combine(_cacheDir, "lumen-tmdb", "w780");
        Directory.CreateDirectory(locked);
        Directory.CreateDirectory(open);
        var oldest = Write(Path.Combine(locked, "oldest.jpg"), 0);
        var older = Write(Path.Combine(open, "older.jpg"), 1);
        var newest = Write(Path.Combine(open, "newest.jpg"), 2);
        File.SetUnixFileMode(locked, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        try
        {
            Cache().Trim();

            // 3 × 400 KB against 90% of 1 MB: the oldest can't go, so the next oldest does instead.
            Assert.True(File.Exists(oldest));
            Assert.False(File.Exists(older));
            Assert.True(File.Exists(newest));
        }
        finally
        {
            File.SetUnixFileMode(locked, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }

        static string Write(string path, int second)
        {
            File.WriteAllBytes(path, new byte[400 * 1024]);
            File.SetLastWriteTimeUtc(path, new DateTime(2026, 1, 1, 0, 0, second, DateTimeKind.Utc));
            return path;
        }
    }

    [Fact]
    public void TryOpen_IsNullForAVanishedFile()
    {
        Assert.Null(TmdbImageCache.TryOpen(Path.Combine(_cacheDir, "w300", "gone.jpg")));
    }

    public void Dispose()
    {
        _http.Dispose();
        if (Directory.Exists(_cacheDir))
        {
            Directory.Delete(_cacheDir, recursive: true);
        }
    }

    private TmdbImageCache Cache() => new(_http.Factory, _store, Paths(), NullLogger<TmdbImageCache>.Instance);

    private IApplicationPaths Paths()
    {
        var paths = Substitute.For<IApplicationPaths>();
        paths.CachePath.Returns(_cacheDir);
        return paths;
    }

    /// <summary>A body of <c>size</c> bytes that doesn't say how long it is (as with chunked encoding).</summary>
    private sealed class UnsizedContent(int size) : HttpContent
    {
        protected override Task SerializeToStreamAsync(Stream stream, System.Net.TransportContext? context) =>
            stream.WriteAsync(new byte[size]).AsTask();

        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return false;
        }
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
