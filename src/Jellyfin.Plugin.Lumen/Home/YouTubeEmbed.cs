namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>
/// Where the client loads YouTube's embedded player from: <c>https://www.youtube-nocookie.com</c>, which the client knows
/// itself. Set <c>LUMEN_YOUTUBE_EMBED_BASE</c> to point it somewhere else (the E2E tests' stub player, as CI can't reach
/// YouTube). It names a page that runs in a frame on every home page, so only an https origin is taken, or plain http on
/// this machine (<c>localhost</c>, <c>127.0.0.1</c>, Docker's <c>host.docker.internal</c>); anything else is ignored.
/// </summary>
public static class YouTubeEmbed
{
    public const string BaseUrlVariable = "LUMEN_YOUTUBE_EMBED_BASE";

    private static readonly string[] LocalHosts = ["localhost", "127.0.0.1", "host.docker.internal"];

    /// <summary>Gets the override from the environment, read once: null (the usual case) leaves the client on YouTube's own address.</summary>
    public static string? OverrideBase { get; } = Normalize(Environment.GetEnvironmentVariable(BaseUrlVariable));

    /// <summary>The origin of <paramref name="value"/> if it may be an embed base (see the class remarks), else null.</summary>
    public static string? Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)
            || !Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || uri.AbsolutePath != "/")
        {
            return null;
        }

        var allowed = uri.Scheme == Uri.UriSchemeHttps
            || (uri.Scheme == Uri.UriSchemeHttp && Array.IndexOf(LocalHosts, uri.IdnHost.ToLowerInvariant()) >= 0);
        return allowed ? uri.GetLeftPart(UriPartial.Authority) : null;
    }
}
