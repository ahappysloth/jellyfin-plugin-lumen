using System.Text.RegularExpressions;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Fetches TMDB artwork server-side so viewers only ever talk to the Jellyfin server.</summary>
public interface ITmdbImageCache
{
    /// <summary>The image file, fetched and cached on first use; null when <paramref name="size"/>/<paramref name="file"/> are not allowed or TMDB has no such image.</summary>
    Task<CachedImage?> GetAsync(string size, string file, CancellationToken cancellationToken);
}

/// <summary>A cached TMDB image file and its content type.</summary>
public sealed record CachedImage(string Path, string ContentType);

/// <summary>
/// Disk cache of TMDB images under Jellyfin's cache directory, trimmed to the configured size (oldest first). Only
/// <see cref="Sizes"/> and file names matching <see cref="FileName"/> are accepted, so it can't be used to fetch
/// anything else. Set <c>LUMEN_TMDB_IMAGE_BASE</c> to point it at a stub (end-to-end tests).
/// </summary>
public sealed partial class TmdbImageCache : ITmdbImageCache
{
    public const string HttpClientName = "Lumen.Tmdb";
    public static readonly IReadOnlySet<string> Sizes = new HashSet<string>(StringComparer.Ordinal) { "w185", "w300", "w780", "w1280", "original" };
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    private const int TrimEveryWrites = 25;

    /// <summary>A TMDB image larger than this is refused rather than cached ("original" posters are a few MB).</summary>
    private const long MaxImageBytes = 25L * 1024 * 1024;

    private static readonly TimeSpan StaleTempAge = TimeSpan.FromHours(1);
    private readonly IHttpClientFactory _http;
    private readonly ILumenConfigStore _config;
    private readonly ILogger<TmdbImageCache> _logger;
    private readonly string _directory;
    private readonly Uri _baseUrl;
    private int _trimming;
    private int _writes;
    private long _bytesSinceTrim;
    private int _startupTrimDone;

    public TmdbImageCache(IHttpClientFactory http, ILumenConfigStore config, IApplicationPaths paths, ILogger<TmdbImageCache> logger)
    {
        _http = http;
        _config = config;
        _logger = logger;
        _directory = Path.Combine(paths.CachePath, "lumen-tmdb");
        var overrideBase = Environment.GetEnvironmentVariable("LUMEN_TMDB_IMAGE_BASE");
        _baseUrl = new Uri((ConfigValidator.IsHttpUrl(overrideBase) ? overrideBase! : "https://image.tmdb.org/t/p").TrimEnd('/') + "/");
    }

    public static bool IsAllowed(string size, string file) => Sizes.Contains(size) && FileName().IsMatch(file);

    public async Task<CachedImage?> GetAsync(string size, string file, CancellationToken cancellationToken)
    {
        if (!IsAllowed(size, file))
        {
            return null;
        }

        var contentType = file.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ? "image/png" : "image/jpeg";
        var path = Path.Combine(_directory, size, file);

        // Once per process: enforce the cap (it may have been lowered) and sweep temp files from interrupted runs.
        if (Interlocked.Exchange(ref _startupTrimDone, 1) == 0)
        {
            _ = Task.Run(Trim, CancellationToken.None);
        }

        if (File.Exists(path))
        {
            TouchQuietly(path);
            return new CachedImage(path, contentType);
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        using var response = await _http.CreateClient(HttpClientName)
            .GetAsync(new Uri(_baseUrl, size + "/" + file), HttpCompletionOption.ResponseHeadersRead, timeout.Token)
            .ConfigureAwait(false);
        if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength > MaxImageBytes)
        {
            return null;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        long written;
        try
        {
            await using (var output = File.Create(temp))
            {
                await response.Content.CopyToAsync(output, timeout.Token).ConfigureAwait(false);
                written = output.Length;
            }

            File.Move(temp, path, overwrite: true);
        }
        finally
        {
            // Cancelled, timed out, or a failed move: never leave the partial file behind (Trim skips .tmp files).
            DeleteQuietly(temp);
        }

        // Trim every few writes, or sooner when the writes since the last trim add up (large "original" images).
        var cap = (long)_config.Current.ImageCacheMb * 1024 * 1024;
        var pending = Interlocked.Add(ref _bytesSinceTrim, written);
        if (Interlocked.Increment(ref _writes) % TrimEveryWrites == 0 || pending > cap / 20)
        {
            _ = Task.Run(Trim, CancellationToken.None);
        }

        return new CachedImage(path, contentType);
    }

    /// <summary>Deletes the least recently used images until the cache is under 90% of its cap.</summary>
    public void Trim()
    {
        if (Interlocked.Exchange(ref _trimming, 1) == 1)
        {
            return;
        }

        try
        {
            if (!Directory.Exists(_directory))
            {
                return;
            }

            Interlocked.Exchange(ref _bytesSinceTrim, 0);
            var cap = (long)_config.Current.ImageCacheMb * 1024 * 1024;
            var all = new DirectoryInfo(_directory).EnumerateFiles("*", SearchOption.AllDirectories).ToList();

            // Temp files from downloads interrupted by a crash or restart (live downloads are much younger).
            foreach (var stale in all.Where(f => f.Name.EndsWith(".tmp", StringComparison.Ordinal) && f.LastWriteTimeUtc < DateTime.UtcNow - StaleTempAge))
            {
                DeleteQuietly(stale.FullName);
            }

            var files = all
                .Where(f => !f.Name.EndsWith(".tmp", StringComparison.Ordinal))
                .OrderBy(f => f.LastWriteTimeUtc)
                .ToList();
            var total = files.Sum(f => f.Length);
            foreach (var file in files)
            {
                if (total <= cap * 9 / 10)
                {
                    break;
                }

                total -= file.Length;
                file.Delete();
            }
        }
        catch (IOException e)
        {
            _logger.LogWarning(e, "Lumen couldn't trim its TMDB image cache");
        }
        finally
        {
            Volatile.Write(ref _trimming, 0);
        }
    }

    private static void DeleteQuietly(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
            // Swept by the next Trim.
        }
        catch (UnauthorizedAccessException)
        {
            // Swept by the next Trim.
        }
    }

    private static void TouchQuietly(string path)
    {
        try
        {
            File.SetLastWriteTimeUtc(path, DateTime.UtcNow);
        }
        catch (IOException)
        {
            // Recency is best-effort; a stale timestamp only makes the image an earlier trim candidate.
        }
    }

    [GeneratedRegex("^[A-Za-z0-9]{1,64}\\.(jpg|png)$")]
    private static partial Regex FileName();
}
