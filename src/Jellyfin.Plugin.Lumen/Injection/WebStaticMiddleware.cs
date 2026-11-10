using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// Serves jellyfin-web's content-addressed files (<see cref="WebStaticFiles"/>) cached for good
/// (<see cref="WebStaticFiles.ImmutableCacheControl"/>) and precompressed: Brotli at its best quality or gzip at its smallest,
/// picked by <see cref="LumenAsset.Select"/>, with an ETag per coding. Jellyfin sends these files with no Cache-Control, so
/// browsers revalidate ~100 of them on every load once a heuristic freshness runs out, and compresses them per response at
/// its fastest level, over plain HTTP only.
/// <para>
/// Jellyfin's pipeline still produces every response (BaseUrl, CORS, HTTPS redirection, other plugins' middleware), with
/// the client's Accept-Encoding and validators held back so it's the whole file. Only a 200 that is byte for byte the file
/// on disk is replaced; anything else goes out as Jellyfin made it, and a file the pipeline was seen changing (another plugin
/// rewrites it) is left to Jellyfin from then on. Until a file's copies are ready, and for HEAD, Range, other plugins'
/// files, or with the setting off, requests pass through untouched. Like <see cref="IndexHtmlMiddleware"/>, it fails open.
/// </para>
/// </summary>
public sealed class WebStaticMiddleware
{
    private readonly RequestDelegate _next;
    private readonly WebStaticFiles _files;
    private readonly ILogger<WebStaticMiddleware> _logger;
    private int _warnedFailure;

    public WebStaticMiddleware(RequestDelegate next, WebStaticFiles files, ILogger<WebStaticMiddleware> logger)
    {
        _next = next;
        _files = files;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var (file, asset) = Ready(context);
        if (file is null || asset is null)
        {
            await _next(context);
            return;
        }

        var request = context.Request;
        var clientEtags = request.Headers.IfNoneMatch;
        var acceptEncoding = request.Headers.AcceptEncoding;
        request.Headers.Remove(HeaderNames.AcceptEncoding);
        request.Headers.Remove(HeaderNames.IfNoneMatch);
        request.Headers.Remove(HeaderNames.IfModifiedSince);

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

        var response = context.Response;
        var produced = buffer.GetBuffer().AsMemory(0, (int)buffer.Length);
        if (response.StatusCode != StatusCodes.Status200OK || !produced.Span.SequenceEqual(asset.Content))
        {
            if (response.StatusCode == StatusCodes.Status200OK)
            {
                _files.MarkTransformed(file);
            }

            await originalBody.WriteAsync(produced, context.RequestAborted);
            return;
        }

        var representation = asset.Select(acceptEncoding, _logger);
        var headers = response.Headers;
        headers.Remove(HeaderNames.LastModified);
        headers.Remove(HeaderNames.AcceptRanges);
        headers.CacheControl = WebStaticFiles.ImmutableCacheControl;
        headers.ETag = representation.ETag.ToString();
        if (asset.Compressible && !headers.GetCommaSeparatedValues(HeaderNames.Vary).Contains(HeaderNames.AcceptEncoding, StringComparer.OrdinalIgnoreCase))
        {
            headers.Append(HeaderNames.Vary, HeaderNames.AcceptEncoding);
        }

        if (Matches(clientEtags, representation.ETag))
        {
            response.StatusCode = StatusCodes.Status304NotModified;
            response.ContentLength = null;
            return;
        }

        if (representation.ContentEncoding is { } encoding)
        {
            headers.ContentEncoding = encoding;
        }
        else
        {
            headers.Remove(HeaderNames.ContentEncoding);
        }

        response.ContentLength = representation.Content.Length;
        await originalBody.WriteAsync(representation.Content, context.RequestAborted);
    }

    /// <summary>If-None-Match against the representation's tag, by weak comparison (as for GET), or <c>*</c>.</summary>
    private static bool Matches(StringValues ifNoneMatch, EntityTagHeaderValue etag) =>
        EntityTagHeaderValue.TryParseList(ifNoneMatch, out var tags)
        && tags.Any(tag => tag.Equals(EntityTagHeaderValue.Any) || tag.Compare(etag, useStrongComparison: false));

    /// <summary>The request's file and its ready copies, when it's served from them; else (null, null) to pass it through.</summary>
    private (WebFile? File, LumenAsset? Asset) Ready(HttpContext context)
    {
        try
        {
            if (_files.Find(context.Request) is not { } file || _files.IsTransformed(file))
            {
                return (null, null);
            }

            var config = context.RequestServices.GetService(typeof(ILumenConfigReader)) as ILumenConfigReader;
            if (config?.Current.OptimizeWebClientFiles == false)
            {
                return (null, null);
            }

            return (file, _files.TryGetReady(file));
        }
        catch (Exception ex)
        {
            if (Interlocked.Exchange(ref _warnedFailure, 1) == 0)
            {
                _logger.LogError(ex, "Lumen failed to look up a jellyfin-web file; serving it as Jellyfin does");
            }

            return (null, null);
        }
    }
}
