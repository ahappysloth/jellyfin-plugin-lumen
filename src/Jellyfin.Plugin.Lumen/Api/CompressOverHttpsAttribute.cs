using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>
/// Lets Jellyfin's response compression compress this action's response over HTTPS too.
/// <para>
/// Jellyfin calls <c>AddResponseCompression()</c> with the defaults, which compress only plain HTTP responses: a
/// response that holds a secret and echoes request input can leak the secret through its compressed size (BREACH). So
/// this is opted into per action, on Lumen's own large JSON responses that hold no secret (a home is ~120 KB, ~34 KB
/// with Brotli), and never on Jellyfin's endpoints. Don't put it on an action whose response carries a key or token,
/// like the Seerr admin endpoints or the request status (its image token).
/// </para>
/// <para>
/// The compression middleware sets <see cref="IHttpsCompressionFeature"/> before MVC runs and reads it when the
/// response starts, so setting its mode here applies to this response only.
/// </para>
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class CompressOverHttpsAttribute : ActionFilterAttribute
{
    public override void OnActionExecuting(ActionExecutingContext context)
    {
        if (context.HttpContext.Features.Get<IHttpsCompressionFeature>() is { } compression)
        {
            compression.Mode = HttpsCompressionMode.Compress;
        }
    }
}
