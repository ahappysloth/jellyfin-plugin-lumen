using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>Adds Lumen's stylesheet and script to jellyfin-web's index.html. Pure and idempotent.</summary>
public static partial class HtmlInjector
{
    public const string Marker = "<!-- lumen:injected -->";

    /// <summary>The client's inline guard bundle (client/src/veil/guard.ts).</summary>
    public const string GuardAsset = "lumen-guard.js";

    // Relative to /web/ (or <BaseUrl>/web/), so "../Lumen" resolves to <BaseUrl>/Lumen.
    private const string AssetBase = "../Lumen/Assets/";

    /// <summary>Injects Lumen's tags before &lt;/head&gt;.</summary>
    /// <param name="html">jellyfin-web's index.html.</param>
    /// <param name="buildHash">Cache-busting hash for the asset URLs.</param>
    /// <param name="guardScript">
    /// The guard's JavaScript, inlined so it runs synchronously before jellyfin-web paints: on routes Lumen may take
    /// over it hides the stock chrome and shows the loading veil until lumen.js (deferred) takes over. Null skips it.
    /// </param>
    /// <param name="styleStockPages">
    /// Marks the page (<c>data-lmn-skin</c> on &lt;html&gt;) so Lumen restyles the sign-in page, which loads before
    /// anyone is signed in and so can't read Lumen's per-user client config.
    /// </param>
    /// <param name="installAsLumen">
    /// Points the web app manifest, Apple touch icon and theme colour at Lumen's, so a home-screen install gets the J.
    /// </param>
    public static string Inject(string html, string buildHash, string? guardScript = null, bool styleStockPages = false, bool installAsLumen = false)
    {
        if (html.Contains(Marker, StringComparison.Ordinal))
        {
            return html;
        }

        var headClose = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
        if (headClose < 0)
        {
            return html;
        }

        var version = Uri.EscapeDataString(buildHash);
        var skin = styleStockPages ? "document.documentElement.setAttribute('data-lmn-skin','');" : string.Empty;
        var script = skin + (guardScript ?? string.Empty);
        var guard = script.Length == 0
            ? string.Empty
            : "<script>" + script.Replace("</", "<\\/", StringComparison.Ordinal) + "</script>";
        var tags = $"{Marker}{guard}<link rel=\"stylesheet\" href=\"{AssetBase}lumen.css?v={version}\">"
            + $"<script defer src=\"{AssetBase}lumen.js?v={version}\"></script>";

        var page = string.Concat(html.AsSpan(0, headClose), tags, html.AsSpan(headClose));
        return installAsLumen ? UseLumenAppIdentity(page, version) : page;
    }

    /// <summary>Swaps jellyfin-web's manifest, touch icons and theme colour for Lumen's (only those tags).</summary>
    internal static string UseLumenAppIdentity(string html, string version)
    {
        html = ManifestLink().Replace(html, "<link rel=\"manifest\" href=\"../Lumen/Manifest\">", 1);
        html = TouchIconLink().Replace(html, string.Empty);
        html = ThemeColorMeta().Replace(html, $"<meta id=\"themeColor\" name=\"theme-color\" content=\"{Api.LumenController.PwaColor}\">", 1);
        var touchIcon = $"<link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"{AssetBase}lumen-icon-180.png?v={version}\">";
        var marker = html.IndexOf(Marker, StringComparison.Ordinal);
        return marker < 0 ? html : html.Insert(marker + Marker.Length, touchIcon);
    }

    [GeneratedRegex("<link\\s+rel=\"manifest\"[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex ManifestLink();

    [GeneratedRegex("<link\\s+rel=\"apple-touch-icon\"[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex TouchIconLink();

    [GeneratedRegex("<meta\\s+id=\"themeColor\"[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex ThemeColorMeta();
}
