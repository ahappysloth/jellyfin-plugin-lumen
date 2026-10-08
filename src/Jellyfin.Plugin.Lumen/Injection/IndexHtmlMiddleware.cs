using System.Security.Cryptography;
using System.Text;
using Jellyfin.Plugin.Lumen.Assets;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// Rewrites jellyfin-web's index.html to load Lumen. Runs before Jellyfin's BaseUrl mapping and response
/// compression, so it strips the request headers that would make the inner pipeline return a compressed,
/// partial, or 304 response, and then replaces the validators with a hash of the rewritten page.
/// </summary>
public sealed class IndexHtmlMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<IndexHtmlMiddleware> _logger;
    private int _warnedNoHead;

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

        var clientEtag = context.Request.Headers.IfNoneMatch.ToString();
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

        if (context.Response.StatusCode != StatusCodes.Status200OK
            || context.Response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) != true)
        {
            buffer.Position = 0;
            await buffer.CopyToAsync(originalBody, context.RequestAborted);
            return;
        }

        var output = Transform(buffer.ToArray(), assets.BuildHash);
        var etag = "\"lmn-" + Convert.ToHexStringLower(SHA256.HashData(output))[..16] + "\"";

        context.Response.Headers.Remove(HeaderNames.LastModified);
        context.Response.Headers.ETag = etag;

        if (string.Equals(clientEtag, etag, StringComparison.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status304NotModified;
            context.Response.ContentLength = null;
            return;
        }

        context.Response.ContentLength = output.Length;
        await originalBody.WriteAsync(output, context.RequestAborted);
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

    private byte[] Transform(byte[] original, string buildHash)
    {
        try
        {
            var html = Encoding.UTF8.GetString(original);
            var injected = HtmlInjector.Inject(html, buildHash);
            if (ReferenceEquals(injected, html) && !html.Contains(HtmlInjector.Marker, StringComparison.Ordinal)
                && Interlocked.Exchange(ref _warnedNoHead, 1) == 0)
            {
                _logger.LogWarning("Lumen could not find </head> in index.html; the stock UI will be served");
            }

            return Encoding.UTF8.GetBytes(injected);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lumen failed to rewrite index.html; serving the original");
            return original;
        }
    }
}
