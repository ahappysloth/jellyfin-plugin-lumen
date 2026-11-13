namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>
/// Where the client loads YouTube's embedded player from: <c>https://www.youtube-nocookie.com</c>, which the client knows
/// itself. Set <c>LUMEN_YOUTUBE_EMBED_BASE</c> to point it somewhere else (the E2E tests' stub player, as CI can't reach
/// YouTube). It names a page that runs in a frame on every home page, so only an https origin is taken, or plain http on
/// this machine (<see cref="TestAddress"/>); anything else is ignored.
/// </summary>
public static class YouTubeEmbed
{
    public const string BaseUrlVariable = "LUMEN_YOUTUBE_EMBED_BASE";

    /// <summary>Gets the override from the environment, read once: null (the usual case) leaves the client on YouTube's own address.</summary>
    public static string? OverrideBase { get; } = Normalize(Environment.GetEnvironmentVariable(BaseUrlVariable));

    /// <summary>The origin of <paramref name="value"/> if it may be an embed base (see <see cref="TestAddress"/>), else null.</summary>
    public static string? Normalize(string? value) => TestAddress.Origin(value);
}
