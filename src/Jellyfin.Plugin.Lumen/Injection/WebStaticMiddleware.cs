using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// Serves jellyfin-web's built files (<see cref="WebStaticFiles"/>) precompressed: Brotli at its best quality or gzip at its
/// smallest, picked by <see cref="LumenAsset.Select"/>, with an ETag per coding, and with the Cache-Control
/// <see cref="WebStaticFiles.CacheControlFor"/> allows (a week for a verified content hash, no-cache for the bundles
/// index.html loads, else Jellyfin's). Jellyfin compresses these files per response at its fastest level, over plain HTTP
/// only, and sends no Cache-Control, so browsers revalidate them on heuristic freshness.
/// <para>
/// Jellyfin's pipeline still produces every response (BaseUrl, CORS, HTTPS redirection, other plugins' middleware), with
/// the client's Accept-Encoding and validators held back so it's the whole file, and put back afterwards for the
/// middleware around this one. What it writes is compared with the file as it streams; only a 200 that is byte for byte
/// the file on disk is replaced. Anything else goes out as Jellyfin made it, and a file the pipeline was seen changing
/// (another plugin rewrites it) is left to Jellyfin from then on. Until a file's copies are ready, and for HEAD, Range,
/// other files, or with the setting off, requests pass through untouched. Like <see cref="IndexHtmlMiddleware"/>, it
/// fails open.
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
        var (file, ready) = Ready(context);
        if (file is null || ready is null)
        {
            await _next(context);
            return;
        }

        var asset = ready.Asset;
        var requestHeaders = context.Request.Headers;
        var acceptEncoding = requestHeaders.AcceptEncoding;
        var ifNoneMatch = requestHeaders.IfNoneMatch;
        var ifModifiedSince = requestHeaders.IfModifiedSince;
        requestHeaders.Remove(HeaderNames.AcceptEncoding);
        requestHeaders.Remove(HeaderNames.IfNoneMatch);
        requestHeaders.Remove(HeaderNames.IfModifiedSince);

        var originalBody = context.Response.Body;
        using var produced = new MatchingStream(asset.Content);
        context.Response.Body = produced;
        try
        {
            await _next(context);
        }
        finally
        {
            context.Response.Body = originalBody;
            Restore(requestHeaders, HeaderNames.AcceptEncoding, acceptEncoding);
            Restore(requestHeaders, HeaderNames.IfNoneMatch, ifNoneMatch);
            Restore(requestHeaders, HeaderNames.IfModifiedSince, ifModifiedSince);
        }

        var response = context.Response;
        if (response.StatusCode != StatusCodes.Status200OK || !produced.Matches)
        {
            if (response.StatusCode == StatusCodes.Status200OK)
            {
                _files.MarkTransformed(file);
            }

            await originalBody.WriteAsync(produced.Written, context.RequestAborted);
            return;
        }

        var representation = asset.Select(acceptEncoding, _logger);
        var headers = response.Headers;
        headers.Remove(HeaderNames.AcceptRanges);
        if (WebStaticFiles.CacheControlFor(file, ready.HashMatches) is { } cacheControl)
        {
            headers.CacheControl = cacheControl;
        }

        headers.ETag = representation.ETag.ToString();
        if (asset.Compressible && !headers.GetCommaSeparatedValues(HeaderNames.Vary).Contains(HeaderNames.AcceptEncoding, StringComparer.OrdinalIgnoreCase))
        {
            headers.Append(HeaderNames.Vary, HeaderNames.AcceptEncoding);
        }

        if (NotModified(ifNoneMatch, ifModifiedSince, representation.ETag, file.Stamp.LastModified))
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

    /// <summary>
    /// If-None-Match against the representation's tag, by weak comparison (as for GET), or <c>*</c>; without it,
    /// If-Modified-Since against the file's time (to the second, as Last-Modified has it).
    /// </summary>
    private static bool NotModified(StringValues ifNoneMatch, StringValues ifModifiedSince, EntityTagHeaderValue etag, DateTimeOffset lastModified)
    {
        if (!StringValues.IsNullOrEmpty(ifNoneMatch))
        {
            return EntityTagHeaderValue.TryParseList(ifNoneMatch, out var tags)
                && tags.Any(tag => tag.Equals(EntityTagHeaderValue.Any) || tag.Compare(etag, useStrongComparison: false));
        }

        return HeaderUtilities.TryParseDate(ifModifiedSince.ToString(), out var since)
            && lastModified.ToUnixTimeSeconds() <= since.ToUnixTimeSeconds();
    }

    private static void Restore(IHeaderDictionary headers, string name, StringValues value)
    {
        if (!StringValues.IsNullOrEmpty(value))
        {
            headers[name] = value;
        }
    }

    /// <summary>The request's file and its ready copies, when it's served from them; else (null, null) to pass it through.</summary>
    private (WebFile? File, ReadyFile? Ready) Ready(HttpContext context)
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
