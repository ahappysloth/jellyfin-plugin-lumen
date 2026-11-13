namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>
/// Addresses the E2E tests point Lumen at in place of a real service (<c>LUMEN_YOUTUBE_EMBED_BASE</c>,
/// <c>LUMEN_IMDB_API_BASE</c>, <c>LUMEN_IMDB_VIDEO_BASE</c>). Only an https address is taken, or plain http on this machine
/// (<c>localhost</c>, <c>127.0.0.1</c>, Docker's <c>host.docker.internal</c>): never one that names a user, a query or a
/// fragment. Anything else is ignored, and the real service is used.
/// </summary>
public static class TestAddress
{
    private static readonly string[] LocalHosts = ["localhost", "127.0.0.1", "host.docker.internal"];

    /// <summary>The origin of <paramref name="value"/> (no path but <c>/</c>), or null if it may not be one.</summary>
    public static string? Origin(string? value) =>
        Parse(value) is { AbsolutePath: "/" } uri ? uri.GetLeftPart(UriPartial.Authority) : null;

    /// <summary><paramref name="value"/> as an address that may have a path, or null if it may not be one.</summary>
    public static Uri? Url(string? value) => Parse(value);

    private static Uri? Parse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)
            || !Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment))
        {
            return null;
        }

        var allowed = uri.Scheme == Uri.UriSchemeHttps
            || (uri.Scheme == Uri.UriSchemeHttp && Array.IndexOf(LocalHosts, uri.IdnHost.ToLowerInvariant()) >= 0);
        return allowed ? uri : null;
    }
}
