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
/// </summary>
public sealed class IndexHtmlMiddleware
{
    /// <summary>Smaller pages are sent uncompressed: compression wouldn't pay for itself.</summary>
    private const int MinCompressBytes = 1024;

    private readonly RequestDelegate _next;
    private readonly ILogger<IndexHtmlMiddleware> _logger;
    private Rendered? _cache;
    private int _warnedNoHead;
    private int _warnedIdentity;
    private int _warnedFailure;

    public IndexHtmlMiddleware(RequestDelegate next, ILogger<IndexHtmlMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context, AssetCatalog assets)
    {
        if (!IsIndexRequest(context.Request))
        {
            await _next(context);
            return;
        }

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
            && context.Response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) == true)
        {
            try
            {
                rendered = Render(original, assets, context.RequestServices.GetService(typeof(ILumenConfigReader)) as ILumenConfigReader);
            }
            catch (Exception ex)
            {
                // Anything at all (the config store, the rewrite, compression): serve jellyfin-web's page untouched.
                if (Interlocked.Exchange(ref _warnedFailure, 1) == 0)
                {
                    _logger.LogError(ex, "Lumen failed to rewrite index.html; serving the original");
                }
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
        var injected = HtmlInjector.Inject(html, assets.BuildHash, guard, skin, appIdentity, notFound, config?.AccentColor);
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

        var output = Encoding.UTF8.GetBytes(injected);
        var hash = Convert.ToHexStringLower(SHA256.HashData(output))[..16];
        var compress = output.Length >= MinCompressBytes;
        var rendered = new Rendered(
            assets.BuildHash,
            configVersion,
            original,
            output,
            "\"lmn-" + hash + "\"",
            compress ? Compress(output, s => new GZipStream(s, CompressionLevel.Optimal, leaveOpen: true)) : null,
            compress ? Compress(output, s => new BrotliStream(s, CompressionLevel.Optimal, leaveOpen: true)) : null);
        Volatile.Write(ref _cache, rendered);
        return rendered;
    }

    /// <summary>A rewritten page and what it was made from. Each encoding gets its own ETag, as HTTP requires.</summary>
    private sealed record Rendered(string BuildHash, int ConfigVersion, byte[] Input, byte[] Output, string ETag, byte[]? Gzip, byte[]? Brotli)
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
