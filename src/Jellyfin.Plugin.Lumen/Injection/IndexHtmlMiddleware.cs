using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// Rewrites jellyfin-web's index.html to load Lumen. Runs before Jellyfin's BaseUrl mapping, response compression and
/// error handling, so it strips the request headers that would make the inner pipeline return a compressed, partial,
/// or 304 response, and then replaces the validators with a hash of the rewritten page.
/// <para>
/// It fails open: if anything goes wrong after the inner pipeline has produced the page (reading Lumen's config,
/// rewriting, compressing), the original page is served, so a Lumen bug can never take down the web UI.
/// </para>
/// <para>
/// The rewritten page, with its gzip and Brotli encodings, is cached for as long as the build, the configuration
/// version and jellyfin-web's page stay the same, so most requests only compare the page to the cached input.
/// </para>
/// <para>
/// It also lists Lumen's jellyfin-web plugin in <c>config.json</c> (<see cref="WebConfigInjector"/>), the same way, but
/// only while the page it serves defines that plugin: the current page (same build and configuration) was rewritten
/// with the inline guard, and Lumen is on. jellyfin-web fetches config.json after the page, so a page served without
/// the guard (Lumen off, no guard in the build, no &lt;/head&gt;, a failed rewrite) never meets a config.json that lists it.
/// Otherwise config.json passes through untouched.
/// </para>
/// </summary>
public sealed class IndexHtmlMiddleware
{
    /// <summary>Smaller pages are sent uncompressed: compression wouldn't pay for itself.</summary>
    private const int MinCompressBytes = 1024;

    private readonly RequestDelegate _next;
    private readonly ILogger<IndexHtmlMiddleware> _logger;
    private Rendered? _cache;
    private Rendered? _configCache;
    private int _warnedNoHead;
    private int _warnedIdentity;
    private int _warnedFailure;
    private int _warnedConfigFailure;

    public IndexHtmlMiddleware(RequestDelegate next, ILogger<IndexHtmlMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context, AssetCatalog assets)
    {
        if (IsIndexRequest(context.Request))
        {
            var store = ConfigReader(context);
            await RewriteAsync(context, "text/html", original => Render(original, assets, store), ex =>
            {
                // That page goes out without the guard, so config.json mustn't list the plugin the guard defines.
                Volatile.Write(ref _cache, null);
                Warn(ex, "index.html", ref _warnedFailure);
            });
        }
        else if (IsWebConfigRequest(context.Request) && ServesWebPlugin(assets, ConfigReader(context)))
        {
            await RewriteAsync(context, "application/json", RenderWebConfig, ex => Warn(ex, "config.json", ref _warnedConfigFailure));
        }
        else
        {
            await _next(context);
        }
    }

    internal static bool IsIndexRequest(HttpRequest request)
    {
        if (!HttpMethods.IsGet(request.Method))
        {
            return false;
        }

        var path = request.Path.Value ?? string.Empty;
        return path.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase);
    }

    internal static bool IsWebConfigRequest(HttpRequest request) =>
        HttpMethods.IsGet(request.Method)
        && (request.Path.Value ?? string.Empty).EndsWith("/web/config.json", StringComparison.OrdinalIgnoreCase);

    private static ILumenConfigReader? ConfigReader(HttpContext context) =>
        context.RequestServices.GetService(typeof(ILumenConfigReader)) as ILumenConfigReader;

    private static bool MatchesAny(StringValues ifNoneMatch, string etag) =>
        ifNoneMatch.SelectMany(v => (v ?? string.Empty).Split(',')).Any(v => string.Equals(v.Trim(), etag, StringComparison.Ordinal));

    private static byte[] Compress(byte[] data, Func<Stream, Stream> encoder)
    {
        using var output = new MemoryStream();
        using (var stream = encoder(output))
        {
            stream.Write(data);
        }

        return output.ToArray();
    }

    private static Rendered Encode(string buildHash, int configVersion, byte[] input, byte[] output, bool definesWebPlugin)
    {
        var hash = Convert.ToHexStringLower(SHA256.HashData(output))[..16];
        var compress = output.Length >= MinCompressBytes;
        return new Rendered(
            buildHash,
            configVersion,
            input,
            output,
            "\"lmn-" + hash + "\"",
            compress ? Compress(output, s => new GZipStream(s, CompressionLevel.Optimal, leaveOpen: true)) : null,
            compress ? Compress(output, s => new BrotliStream(s, CompressionLevel.Optimal, leaveOpen: true)) : null,
            definesWebPlugin);
    }

    private void Warn(Exception ex, string file, ref int warned)
    {
        if (Interlocked.Exchange(ref warned, 1) == 0)
        {
            _logger.LogError(ex, "Lumen failed to rewrite {File}; serving the original", file);
        }
    }

    /// <summary>
    /// Runs the inner pipeline for the whole file and serves <paramref name="render"/>'s rewrite of it, or the file as it
    /// was when the response isn't a 200 of <paramref name="contentType"/>, or the rewrite is null or fails.
    /// </summary>
    private async Task RewriteAsync(HttpContext context, string contentType, Func<byte[], Rendered?> render, Action<Exception> failed)
    {
        var clientEtags = context.Request.Headers.IfNoneMatch;
        var acceptEncoding = context.Request.Headers.AcceptEncoding;
        context.Request.Headers.Remove(HeaderNames.AcceptEncoding);
        context.Request.Headers.Remove(HeaderNames.IfNoneMatch);
        context.Request.Headers.Remove(HeaderNames.IfModifiedSince);
        context.Request.Headers.Remove(HeaderNames.Range);

        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;
        try
        {
            await _next(context);
        }
        finally
        {
            context.Response.Body = originalBody;
        }

        var original = buffer.ToArray();
        Rendered? rendered = null;
        if (context.Response.StatusCode == StatusCodes.Status200OK
            && context.Response.ContentType?.StartsWith(contentType, StringComparison.OrdinalIgnoreCase) == true)
        {
            try
            {
                rendered = render(original);
            }
            catch (Exception ex)
            {
                // Anything at all (the config store, the rewrite, compression): serve jellyfin-web's file untouched.
                failed(ex);
            }
        }

        if (rendered is null)
        {
            await originalBody.WriteAsync(original, context.RequestAborted);
            return;
        }

        var (body, encoding, etag) = rendered.Select(acceptEncoding);
        var headers = context.Response.Headers;
        headers.Remove(HeaderNames.LastModified);
        headers.ETag = etag;
        headers.Vary = HeaderNames.AcceptEncoding;
        if (encoding is null)
        {
            headers.Remove(HeaderNames.ContentEncoding);
        }
        else
        {
            headers.ContentEncoding = encoding;
        }

        if (MatchesAny(clientEtags, etag))
        {
            context.Response.StatusCode = StatusCodes.Status304NotModified;
            context.Response.ContentLength = null;
            headers.Remove(HeaderNames.ContentEncoding);
            return;
        }

        context.Response.ContentLength = body.Length;
        await originalBody.WriteAsync(body, context.RequestAborted);
    }

    /// <summary>The rewritten page for <paramref name="original"/>, from the cache when nothing it depends on changed.</summary>
    private Rendered Render(byte[] original, AssetCatalog assets, ILumenConfigReader? store)
    {
        var config = store?.Current;
        var configVersion = config?.ConfigVersion ?? -1;
        if (Volatile.Read(ref _cache) is { } cached
            && cached.BuildHash == assets.BuildHash
            && cached.ConfigVersion == configVersion
            && cached.Input.AsSpan().SequenceEqual(original))
        {
            return cached;
        }

        // With Lumen switched off nothing will lift the loading veil quickly, so don't put it up.
        var guard = config?.Enabled != false && assets.TryGet(HtmlInjector.GuardAsset, out var guardAsset)
            ? Encoding.UTF8.GetString(guardAsset.Content)
            : null;
        var skin = config is { Enabled: true, StyleStockPages: true };
        var appIdentity = config is { Enabled: true };
        var html = Encoding.UTF8.GetString(original);
        var notFound = new List<string>();
        var injected = HtmlInjector.Inject(html, assets.BuildHash, guard, skin, appIdentity, notFound, config?.AccentColor, assets.CoreChunk);
        if (ReferenceEquals(injected, html) && !html.Contains(HtmlInjector.Marker, StringComparison.Ordinal)
            && Interlocked.Exchange(ref _warnedNoHead, 1) == 0)
        {
            _logger.LogWarning("Lumen could not find </head> in index.html; the stock UI will be served");
        }

        if (notFound.Count > 0 && Interlocked.Exchange(ref _warnedIdentity, 1) == 0)
        {
            _logger.LogWarning(
                "Lumen could not find jellyfin-web's {Tags} in index.html (its markup may have changed); home-screen installs may keep Jellyfin's name and icon",
                string.Join(", ", notFound));
        }

        // The guard defines Lumen's jellyfin-web plugin; only a page that carries it may meet a config.json listing it.
        var definesWebPlugin = guard is not null
            && !ReferenceEquals(injected, html)
            && guard.Contains(WebConfigInjector.PluginName, StringComparison.Ordinal);
        var rendered = Encode(assets.BuildHash, configVersion, original, Encoding.UTF8.GetBytes(injected), definesWebPlugin);
        Volatile.Write(ref _cache, rendered);
        return rendered;
    }

    /// <summary>
    /// True when config.json should list Lumen's jellyfin-web plugin: Lumen is on, and the page last served for this build
    /// and configuration defines the plugin. A failure to tell (the config store) means no.
    /// </summary>
    private bool ServesWebPlugin(AssetCatalog assets, ILumenConfigReader? store)
    {
        try
        {
            var config = store?.Current;
            return config is { Enabled: true }
                && Volatile.Read(ref _cache) is { DefinesWebPlugin: true } page
                && page.BuildHash == assets.BuildHash
                && page.ConfigVersion == config.ConfigVersion;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>config.json listing Lumen's plugin (cached while jellyfin-web's file stays the same), or null to leave it.</summary>
    private Rendered? RenderWebConfig(byte[] original)
    {
        if (Volatile.Read(ref _configCache) is { } cached && cached.Input.AsSpan().SequenceEqual(original))
        {
            return cached;
        }

        var json = Encoding.UTF8.GetString(original);
        var listed = WebConfigInjector.AddPlugin(json);
        if (listed is null || ReferenceEquals(listed, json))
        {
            return null;
        }

        var rendered = Encode(string.Empty, 0, original, Encoding.UTF8.GetBytes(listed), definesWebPlugin: false);
        Volatile.Write(ref _configCache, rendered);
        return rendered;
    }

    /// <summary>
    /// A rewritten file and what it was made from. Each encoding gets its own ETag, as HTTP requires.
    /// <paramref name="DefinesWebPlugin"/>: the page carries the guard, which defines Lumen's jellyfin-web plugin.
    /// </summary>
    private sealed record Rendered(string BuildHash, int ConfigVersion, byte[] Input, byte[] Output, string ETag, byte[]? Gzip, byte[]? Brotli, bool DefinesWebPlugin)
    {
        /// <summary>The representation to send for the client's <c>Accept-Encoding</c>: Brotli, then gzip, else identity.</summary>
        public (byte[] Body, string? Encoding, string ETag) Select(StringValues acceptEncoding)
        {
            var accepted = StringWithQualityHeaderValue.TryParseList(acceptEncoding, out var list)
                ? list.Where(e => e.Quality is not 0).Select(e => e.Value.Value).ToHashSet(StringComparer.OrdinalIgnoreCase)
                : [];
            if (Brotli is not null && accepted.Contains("br"))
            {
                return (Brotli, "br", ETag[..^1] + "-br\"");
            }

            if (Gzip is not null && accepted.Contains("gzip"))
            {
                return (Gzip, "gzip", ETag[..^1] + "-gz\"");
            }

            return (Output, null, ETag);
        }
    }
}
