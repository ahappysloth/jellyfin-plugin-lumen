using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>
/// Server: Dashboard → Branding → Custom CSS. jellyfin-web adds it to every page, Lumen's included, so a theme written
/// for jellyfin-web (Ultrachromic, say) restyles Lumen's headings and dialogs too, and each @import of another site's CSS
/// holds up every page's start.
/// </summary>
public sealed partial class CustomCssCheck : IHealthCheck
{
    private static readonly HealthFix OpenBranding = new("Open Branding", "dashboard", "branding");

    private readonly IJellyfinFacts _jellyfin;

    public CustomCssCheck(IJellyfinFacts jellyfin)
    {
        _jellyfin = jellyfin;
    }

    public string Id => "server.customCss";

    public string Group => HealthGroup.Server;

    public string Title => "Branding custom CSS";

    public Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        var css = _jellyfin.BrandingCustomCss;
        if (string.IsNullOrWhiteSpace(css))
        {
            return Task.FromResult(this.Result(HealthStatus.Ok, "No custom CSS is set, so nothing restyles Lumen's pages."));
        }

        var imports = RemoteImport().Count(css);
        var message = "Dashboard → Branding has custom CSS. Jellyfin adds it to Lumen's pages too, where a theme made for "
            + "Jellyfin's own pages can change Lumen's fonts, blur its dialogs or hide parts of it."
            + (imports > 0
                ? $" It also loads {HealthText.Plural(imports, "stylesheet")} from other sites (@import), which slows every page's start."
                : string.Empty)
            + " If Lumen looks wrong, try it without.";
        return Task.FromResult(this.Result(HealthStatus.Warning, message, OpenBranding));
    }

    /// <summary>An @import of a stylesheet on another site: <c>@import url("https://…")</c> or <c>@import "//…"</c>.</summary>
    [GeneratedRegex(@"@import\s+(?:url\(\s*)?[""']?(?:https?:)?//", RegexOptions.IgnoreCase)]
    private static partial Regex RemoteImport();
}
