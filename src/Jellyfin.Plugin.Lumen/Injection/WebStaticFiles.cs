using System.Collections.Concurrent;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using Jellyfin.Plugin.Lumen.Assets;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Extensions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// jellyfin-web's built files, as <see cref="WebStaticMiddleware"/> serves them: which requests it takes, how long they may
/// be cached, and their Brotli and gzip copies (made by <see cref="LumenAsset"/>, as for Lumen's own files).
/// <para>
/// A request qualifies when it's a GET for <c>{BaseUrl}/web/&lt;file&gt;</c> (Jellyfin's web root, read the way its static
/// file middleware reads it), the file exists, and it's one of these.
/// <list type="bullet">
/// <item>One of the files jellyfin-web's index.html loads with a hash in the query (<c>main.jellyfin.bundle.js?&lt;hash&gt;</c>
/// and its stylesheets). That hash is HtmlWebpackPlugin's build hash, the same for every file, so it doesn't vouch for any
/// file's bytes: these are sent <see cref="NoCacheControl"/>, revalidated by ETag on every load.</item>
/// <item>A file named with webpack's content hash (<c>12345.0123456789abcdef0123.chunk.js</c>, fonts, CSS). When the hash checks
/// out against the bytes (<see cref="HashMatchesContent"/>) they may be kept for <see cref="WeekCacheControl"/>, not for
/// good: a plugin that patches jellyfin-web in Jellyfin's pipeline (File Transformation and the plugins built on it) can be
/// installed or start patching later, and must reach browsers within a week. While File Transformation is loaded, nothing
/// gets a lifetime. A file whose hash doesn't check out (patched on disk) keeps Jellyfin's caching.</item>
/// </list>
/// serviceworker.js, index.html, config.json, themes, assets and *.LICENSE.txt are left to Jellyfin.
/// </para>
/// <para>
/// The copies are made in the background, one file at a time, the first time a file is asked for (and, from
/// <see cref="StartWarmup"/>, for the bundles index.html loads), and kept in memory, least recently used out first, up to
/// <see cref="DefaultCapacityBytes"/>: jellyfin-web has ~2,300 files (~60 MB, half of it fonts), but a session uses a few
/// MB of them. Until a file's copies are ready, its requests go to Jellyfin as before.
/// </para>
/// </summary>
public sealed partial class WebStaticFiles : IDisposable
{
    /// <summary>For a file whose name's content hash matches its bytes: a week, so a later patch still gets through.</summary>
    public const string WeekCacheControl = "public, max-age=604800";

    /// <summary>For the files index.html loads by a build-wide hash: revalidated every time (a 304 when unchanged).</summary>
    public const string NoCacheControl = "no-cache";

    /// <summary>The plugin other plugins patch jellyfin-web's files through, in memory, in Jellyfin's pipeline.</summary>
    internal const string FileTransformationAssembly = "Jellyfin.Plugin.FileTransformation";

    /// <summary>The memory kept for files and their copies (jellyfin-web's startup bundles and copies take ~5 MB).</summary>
    internal const long DefaultCapacityBytes = 32L * 1024 * 1024;

    /// <summary>Bigger files go to Jellyfin as before (jellyfin-web 12.4's biggest is 1 MB).</summary>
    internal const long MaxFileBytes = 8L * 1024 * 1024;

    /// <summary>How often to look again for <see cref="FileTransformationAssembly"/> until it's found.</summary>
    internal static readonly TimeSpan AssemblyRecheckInterval = TimeSpan.FromSeconds(30);

    private const string ServiceWorker = "serviceworker.js";
    private const string LicenseSuffix = ".LICENSE.txt";

    private readonly PhysicalFileProvider? _files;
    private readonly FileExtensionContentTypeProvider _types = JellyfinContentTypes();
    private readonly long _capacity;
    private readonly Func<byte[], string, byte[]>? _compress;
    private readonly ILogger _logger;
    private readonly AssemblyWatch _fileTransformation;
    private readonly Lock _gate = new();
    private readonly Dictionary<string, LinkedListNode<Entry>> _entries = new(StringComparer.Ordinal);
    private readonly LinkedList<Entry> _recency = new();
    private readonly Dictionary<string, Stamp> _transformed = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, byte> _pending = new(StringComparer.Ordinal);
    private readonly Channel<WebFile> _queue = Channel.CreateBounded<WebFile>(new BoundedChannelOptions(512) { SingleReader = true });
    private readonly Lazy<Task> _worker;
    private long _size;
    private ParsedIndex? _index;
    private int _warnedFailure;
    private int _warnedTransformed;

    public WebStaticFiles(IServerConfigurationManager configuration, IConfiguration appConfiguration, TimeProvider time, ILogger<WebStaticFiles> logger)
        : this(HostedWebRoot(configuration, appConfiguration, logger), BaseUrl(configuration), logger, new AssemblyWatch(FileTransformationAssembly, time))
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="WebStaticFiles"/> class. <paramref name="webRoot"/>: jellyfin-web's
    /// directory, or null when Jellyfin doesn't host it. <paramref name="fileTransformation"/>: whether File Transformation is
    /// loaded (by default: never). For tests: <paramref name="compress"/> replaces the real compression (see
    /// <see cref="LumenAsset"/>).
    /// </summary>
    internal WebStaticFiles(
        string? webRoot,
        string? baseUrl,
        ILogger logger,
        AssemblyWatch? fileTransformation = null,
        long capacityBytes = DefaultCapacityBytes,
        Func<byte[], string, byte[]>? compress = null)
    {
        _logger = logger;
        _fileTransformation = fileTransformation ?? new AssemblyWatch(FileTransformationAssembly, TimeProvider.System, () => []);
        _capacity = capacityBytes;
        _compress = compress;
        _worker = new Lazy<Task>(() => Task.Run(DrainAsync));
        Prefix = new PathString((baseUrl ?? string.Empty).TrimEnd('/') + "/web");
        if (webRoot is not null && Directory.Exists(webRoot))
        {
            // Jellyfin's own provider for /web (Startup.cs): it refuses paths outside the root, and hidden and system files.
            _files = new PhysicalFileProvider(Path.GetFullPath(webRoot));
        }
    }

    /// <summary>Gets <c>{BaseUrl}/web</c>, as Jellyfin mapped it when it built its pipeline (a new BaseUrl needs a restart).</summary>
    public PathString Prefix { get; }

    /// <summary>Gets a value indicating whether Jellyfin hosts jellyfin-web, from a directory that exists.</summary>
    public bool Hosted => _files is not null;

    /// <summary>Runs after a queued file is read and before it's checked for changes, for tests.</summary>
    internal Action<WebFile>? AfterRead { get; set; }

    /// <summary>The last <see cref="StartWarmup"/>, for tests.</summary>
    internal Task? Warmup { get; private set; }

    /// <summary>The bytes held (files and their copies), for tests.</summary>
    internal long SizeBytes
    {
        get
        {
            lock (_gate)
            {
                return _size;
            }
        }
    }

    public void Dispose() => _files?.Dispose();

    /// <summary>
    /// Queues the copies of the bundles and stylesheets index.html loads, so the first page load after a restart already
    /// gets them (~3.4 MB of jellyfin-web 12.4, a few seconds of one core). Does nothing when <paramref name="enabled"/>
    /// says no. Never throws.
    /// </summary>
    public Task StartWarmup(Func<bool> enabled) => Warmup = Task.Run(() =>
    {
        try
        {
            if (_files is null || !enabled())
            {
                return;
            }

            foreach (var path in IndexReferences().Keys)
            {
                if (Stat(path, WebFileKind.IndexBundle) is { } file)
                {
                    _ = TryGetReady(file);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Lumen could not read jellyfin-web's index.html to prepare its bundles");
        }
    });

    /// <summary>
    /// True for a file name with webpack's content hash in it (<c>[name].[contenthash].chunk.js</c>,
    /// <c>[name].[contenthash].css</c>, <c>[name].[hash][ext]</c>): 16 to 32 lowercase hex digits between dots, after the
    /// name. Not a <c>*.LICENSE.txt</c>, which carries its chunk's hash, not its own.
    /// </summary>
    internal static bool IsContentHashedName(string fileName) =>
        ContentHashedName().IsMatch(fileName) && !fileName.EndsWith(LicenseSuffix, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Whether the content hash in <paramref name="fileName"/> is webpack's for <paramref name="content"/>: the MD4 of the
    /// bytes with every copy of the hash itself taken out (RealContentHashPlugin hashes a file without its own hash), in hex,
    /// cut to the hash's length. All 2,207 such files of jellyfin-web 12.4 (*.LICENSE.txt aside) match.
    /// </summary>
    internal static bool HashMatchesContent(string fileName, ReadOnlySpan<byte> content)
    {
        var match = ContentHashedName().Match(fileName);
        if (!match.Success || fileName.EndsWith(LicenseSuffix, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var hash = match.Groups[1].Value;
        var hashBytes = Encoding.ASCII.GetBytes(hash);
        byte[] digest;
        if (content.IndexOf(hashBytes) < 0)
        {
            digest = Md4.Hash(content);
        }
        else
        {
            using var stripped = new MemoryStream(content.Length);
            var rest = content;
            for (var at = rest.IndexOf(hashBytes); at >= 0; at = rest.IndexOf(hashBytes))
            {
                stripped.Write(rest[..at]);
                rest = rest[(at + hashBytes.Length)..];
            }

            stripped.Write(rest);
            digest = Md4.Hash(stripped.GetBuffer().AsSpan(0, (int)stripped.Length));
        }

        return Convert.ToHexStringLower(digest).StartsWith(hash, StringComparison.Ordinal);
    }

    /// <summary>A path of plain segments: no empty, "." or ".." segment, and no backslash, so it can't leave the web root.</summary>
    internal static bool IsPlainPath(string path) =>
        path.StartsWith('/')
        && !path.Contains('\\', StringComparison.Ordinal)
        && path[1..].Split('/').All(segment => segment.Length > 0 && segment != "." && segment != "..");

    /// <summary>
    /// The files index.html loads with a hash in the query (src or href <c>"file?hash"</c>, relative to /web/), keyed by
    /// their unescaped path under /web/ with a leading slash, as the request path has it. serviceworker.js is left out.
    /// </summary>
    internal static Dictionary<string, string> ParseIndexReferences(string html)
    {
        var references = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (Match match in QueryHashedReference().Matches(html))
        {
            string path;
            try
            {
                path = Uri.UnescapeDataString(match.Groups[1].Value);
            }
            catch (UriFormatException)
            {
                continue;
            }

            if (path.StartsWith("./", StringComparison.Ordinal))
            {
                path = path[2..];
            }

            // Only plain relative paths under /web/: no scheme, no root-relative or protocol-relative URL, no "..".
            if (path.Length == 0 || path.Contains(':', StringComparison.Ordinal) || path.StartsWith('/') || !IsPlainPath("/" + path)
                || string.Equals(Path.GetFileName(path), ServiceWorker, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            references["/" + path] = match.Groups[2].Value;
        }

        return references;
    }

    /// <summary>
    /// The file a request is for, when Lumen serves it (see the class remarks), else null. Requests with Range or a
    /// precondition other than If-None-Match / If-Modified-Since are left to Jellyfin. The query doesn't matter: a file
    /// index.html loads by a build hash is always revalidated, and a content-hashed name can't change its bytes.
    /// </summary>
    internal WebFile? Find(HttpRequest request)
    {
        if (_files is null
            || !HttpMethods.IsGet(request.Method)
            || !request.Path.StartsWithSegments(Prefix, StringComparison.OrdinalIgnoreCase, out var rest)
            || rest.Value is not { Length: > 1 } subPath)
        {
            return null;
        }

        var headers = request.Headers;
        if (headers.ContainsKey(HeaderNames.Range) || headers.ContainsKey(HeaderNames.IfRange)
            || headers.ContainsKey(HeaderNames.IfMatch) || headers.ContainsKey(HeaderNames.IfUnmodifiedSince)
            || !IsPlainPath(subPath))
        {
            return null;
        }

        if (IndexReferences().ContainsKey(subPath))
        {
            return Stat(subPath, WebFileKind.IndexBundle);
        }

        return IsContentHashedName(subPath[(subPath.LastIndexOf('/') + 1)..]) ? Stat(subPath, WebFileKind.ContentHashed) : null;
    }

    /// <summary>
    /// The Cache-Control to send with <paramref name="file"/>, or null to keep Jellyfin's (none): see the class remarks.
    /// <paramref name="hashMatches"/>: the file's name hash checked out against its bytes.
    /// </summary>
    internal string? CacheControlFor(WebFile file, bool hashMatches) => file.Kind switch
    {
        WebFileKind.IndexBundle => NoCacheControl,
        WebFileKind.ContentHashed when hashMatches && !_fileTransformation.IsLoaded => WeekCacheControl,
        _ => null,
    };

    /// <summary>
    /// The file's content and copies when they're ready and the file hasn't changed since, else null (and they're queued to
    /// be made).
    /// </summary>
    internal ReadyFile? TryGetReady(WebFile file)
    {
        lock (_gate)
        {
            if (_entries.TryGetValue(file.PhysicalPath, out var node))
            {
                if (node.Value.Stamp == file.Stamp)
                {
                    _recency.Remove(node);
                    _recency.AddFirst(node);
                    return node.Value.Ready;
                }

                Remove(node);
            }
        }

        Enqueue(file);
        return null;
    }

    /// <summary>
    /// Whether Jellyfin's pipeline was seen serving something other than the file on disk for this version of it: another
    /// plugin rewrites it, so it's left alone (no lifetime added, not compressed by Lumen).
    /// </summary>
    internal bool IsTransformed(WebFile file)
    {
        lock (_gate)
        {
            return _transformed.TryGetValue(file.PhysicalPath, out var stamp) && stamp == file.Stamp;
        }
    }

    internal void MarkTransformed(WebFile file)
    {
        lock (_gate)
        {
            _transformed[file.PhysicalPath] = file.Stamp;
            if (_entries.TryGetValue(file.PhysicalPath, out var node))
            {
                Remove(node);
            }
        }

        if (Interlocked.Exchange(ref _warnedTransformed, 1) == 0 && _logger.IsEnabled(LogLevel.Information))
        {
            _logger.LogInformation(
                "Jellyfin's pipeline changes jellyfin-web's {File} (another plugin rewrites it), so Lumen serves it as Jellyfin does",
                file.SubPath);
        }
    }

    /// <summary>Waits until every queued file is done, for tests.</summary>
    internal async Task WhenIdleAsync()
    {
        while (!_pending.IsEmpty)
        {
            await Task.Delay(10);
        }
    }

    private static string? HostedWebRoot(IServerConfigurationManager configuration, IConfiguration appConfiguration, ILogger logger)
    {
        try
        {
            // The same switch and path Jellyfin's Startup reads (--nowebclient, hostwebclient, --webdir, JELLYFIN_WEB_DIR).
            return appConfiguration.HostWebClient() ? configuration.ApplicationPaths.WebPath : null;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Lumen could not find jellyfin-web's directory; its files are served as Jellyfin serves them");
            return null;
        }
    }

    private static string? BaseUrl(IServerConfigurationManager configuration)
    {
        try
        {
            return configuration.GetNetworkConfiguration()?.BaseUrl;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>The content types Jellyfin's /web static file middleware serves (Startup.cs): the defaults, .data and .mem.</summary>
    private static FileExtensionContentTypeProvider JellyfinContentTypes()
    {
        var types = new FileExtensionContentTypeProvider();
        types.Mappings[".data"] = "application/octet-stream";
        types.Mappings[".mem"] = "application/octet-stream";
        return types;
    }

    [GeneratedRegex(@"^[^/]+\.([0-9a-f]{16,32})\.[^/]+$", RegexOptions.CultureInvariant)]
    private static partial Regex ContentHashedName();

    [GeneratedRegex(@"\b(?:src|href)\s*=\s*""([^""?#]+)\?([0-9a-f]{16,64})""", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex QueryHashedReference();

    /// <summary>index.html's query-hashed references, parsed again whenever the file on disk changes (an upgrade).</summary>
    private Dictionary<string, string> IndexReferences()
    {
        var info = _files!.GetFileInfo("index.html");
        if (!info.Exists || info.IsDirectory)
        {
            return [];
        }

        var stamp = new Stamp(info.Length, info.LastModified);
        if (Volatile.Read(ref _index) is { } cached && cached.Stamp == stamp)
        {
            return cached.References;
        }

        using var stream = info.CreateReadStream();
        using var reader = new StreamReader(stream, Encoding.UTF8);
        var parsed = new ParsedIndex(stamp, ParseIndexReferences(reader.ReadToEnd()));
        Volatile.Write(ref _index, parsed);
        return parsed.References;
    }

    private WebFile? Stat(string subPath, WebFileKind kind)
    {
        var info = _files!.GetFileInfo(subPath);
        if (!info.Exists || info.IsDirectory || info.PhysicalPath is null || info.Length > MaxFileBytes
            || !_types.TryGetContentType(subPath, out var contentType))
        {
            return null;
        }

        return new WebFile(subPath, info.PhysicalPath, contentType, new Stamp(info.Length, info.LastModified), kind);
    }

    private void Enqueue(WebFile file)
    {
        if (!_pending.TryAdd(file.PhysicalPath, 0))
        {
            return;
        }

        _ = _worker.Value;
        if (!_queue.Writer.TryWrite(file))
        {
            _pending.TryRemove(file.PhysicalPath, out _);
        }
    }

    /// <summary>Makes the queued files' copies one at a time, so it never takes more than one core.</summary>
    private async Task DrainAsync()
    {
        await foreach (var file in _queue.Reader.ReadAllAsync().ConfigureAwait(false))
        {
            try
            {
                Load(file);
            }
            catch (Exception ex)
            {
                if (Interlocked.Exchange(ref _warnedFailure, 1) == 0)
                {
                    _logger.LogWarning(ex, "Lumen could not compress jellyfin-web's {File}; it is served as Jellyfin serves it", file.SubPath);
                }
            }
            finally
            {
                _pending.TryRemove(file.PhysicalPath, out _);
            }
        }
    }

    private void Load(WebFile file)
    {
        var content = File.ReadAllBytes(file.PhysicalPath);
        AfterRead?.Invoke(file);

        // Changed while it was read (an upgrade): the next request queues the new file.
        if (content.Length != file.Stamp.Length || Stat(file.SubPath, file.Kind) is not { } now || now.Stamp != file.Stamp)
        {
            return;
        }

        var hashMatches = file.Kind == WebFileKind.ContentHashed && HashMatchesContent(Path.GetFileName(file.PhysicalPath), content);

        var asset = _compress is null
            ? new LumenAsset(file.SubPath, content, file.ContentType)
            : new LumenAsset(file.SubPath, content, file.ContentType, _compress);
        asset.Precompress();
        var size = content.LongLength;
        if (asset.Compressible)
        {
            size += asset.Select(LumenAsset.Brotli).Content.LongLength + asset.Select(LumenAsset.Gzip).Content.LongLength;
        }

        if (size > _capacity)
        {
            return;
        }

        lock (_gate)
        {
            if (_entries.TryGetValue(file.PhysicalPath, out var old))
            {
                Remove(old);
            }

            _entries[file.PhysicalPath] = _recency.AddFirst(new Entry(file.PhysicalPath, file.Stamp, new ReadyFile(asset, hashMatches), size));
            _size += size;
            while (_size > _capacity && _recency.Last is { } last)
            {
                Remove(last);
            }
        }
    }

    /// <summary>Drops an entry. Callers hold <see cref="_gate"/>.</summary>
    private void Remove(LinkedListNode<Entry> node)
    {
        _recency.Remove(node);
        _entries.Remove(node.Value.Key);
        _size -= node.Value.Size;
    }

    private sealed record Entry(string Key, Stamp Stamp, ReadyFile Ready, long Size);

    private sealed record ParsedIndex(Stamp Stamp, Dictionary<string, string> References);
}
