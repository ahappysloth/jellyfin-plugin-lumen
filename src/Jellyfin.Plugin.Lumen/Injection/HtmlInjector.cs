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
    /// over it hides the stock chrome and shows the loading veil until lumen.js (deferred) takes over. It also defines
    /// Lumen's jellyfin-web plugin (<see cref="WebConfigInjector"/>). Null skips it.
    /// </param>
    /// <param name="styleStockPages">
    /// Marks the page (<c>data-lmn-skin</c> on &lt;html&gt;) so Lumen restyles the sign-in page, which loads before
    /// anyone is signed in and so can't read Lumen's per-user client config, and links the admin pages' stylesheet
    /// (<c>lumen-dashboard.css</c>, applied only on the Dashboard, metadata manager and plugin settings pages).
    /// </param>
    /// <param name="installAsLumen">
    /// Points the web app manifest, Apple touch icon and theme colour at Lumen's, so a home-screen install gets the J.
    /// </param>
    /// <param name="notFound">
    /// With <paramref name="installAsLumen"/>, receives the names of jellyfin-web's tags that weren't there to replace
    /// (Lumen's are added anyway), so the caller can warn that index.html changed shape.
    /// </param>
    /// <param name="accentColor">
    /// The server's accent (<c>#rrggbb</c>; anything else is ignored), for the admin pages' stylesheet: those pages are
    /// outside Lumen's own root, where lumen.js sets the accent, so it comes with the page to be there at first paint.
    /// </param>
    /// <param name="coreChunk">
    /// The client's core file (<see cref="Assets.AssetCatalog.CoreChunk"/>), which lumen.js imports: preloaded alongside it, so
    /// the browser needn't run lumen.js before it starts downloading the code. Null skips it.
    /// </param>
    public static string Inject(
        string html,
        string buildHash,
        string? guardScript = null,
        bool styleStockPages = false,
        bool installAsLumen = false,
        ICollection<string>? notFound = null,
        string? accentColor = null,
        string? coreChunk = null)
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
        var dashboard = styleStockPages
            ? $"<link rel=\"stylesheet\" href=\"{AssetBase}lumen-dashboard.css?v={version}\">"
                + (accentColor is not null && HexColor().IsMatch(accentColor)
                    ? $"<style>html.lmn-skin-dashboard{{--lmn-accent:{accentColor}}}</style>"
                    : string.Empty)
            : string.Empty;
        var tags = $"{Marker}{guard}<link rel=\"stylesheet\" href=\"{AssetBase}lumen.css?v={version}\">{dashboard}"
            + (coreChunk is null ? string.Empty : $"<link rel=\"modulepreload\" href=\"{AssetBase}{Uri.EscapeDataString(coreChunk)}\">")
            + $"<script type=\"module\" src=\"{AssetBase}lumen.js?v={version}\"></script>";

        var page = string.Concat(html.AsSpan(0, headClose), tags, html.AsSpan(headClose));
        return installAsLumen ? UseLumenAppIdentity(page, version, notFound) : page;
    }

    /// <summary>
    /// Swaps jellyfin-web's manifest, touch icons and theme colour for Lumen's (only those tags). The tags are found
    /// whatever the order, quoting and case of their attributes; Lumen's manifest and theme colour take the place of the
    /// first match, and any further matches are removed.
    /// </summary>
    internal static string UseLumenAppIdentity(string html, string version, ICollection<string>? notFound = null)
    {
        html = ReplaceAll(html, ManifestLink(), "<link rel=\"manifest\" href=\"../Lumen/Manifest\">", "manifest link", notFound);
        html = ReplaceAll(html, TouchIconLink(), string.Empty, "apple-touch-icon link", notFound);
        html = ReplaceAll(html, ThemeColorMeta(), $"<meta id=\"themeColor\" name=\"theme-color\" content=\"{Api.LumenController.PwaColor}\">", "theme-color meta", notFound);
        var touchIcon = $"<link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"{AssetBase}lumen-icon-180.png?v={version}\">";
        var marker = html.IndexOf(Marker, StringComparison.Ordinal);
        return marker < 0 ? html : html.Insert(marker + Marker.Length, touchIcon);
    }

    private static string ReplaceAll(string html, Regex pattern, string replacement, string name, ICollection<string>? notFound)
    {
        var count = 0;
        var result = pattern.Replace(html, _ => count++ == 0 ? replacement : string.Empty);
        if (count == 0)
        {
            notFound?.Add(name);
        }

        return result;
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColor();

    /// <summary>A &lt;link&gt; with <c>rel="manifest"</c>, wherever <c>rel</c> sits among its attributes.</summary>
    [GeneratedRegex("<link\\b[^>]*?\\srel\\s*=\\s*(?:\"manifest\"|'manifest'|manifest(?=[\\s/>]))[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex ManifestLink();

    /// <summary>A &lt;link&gt; with <c>rel="apple-touch-icon"</c> (any sizes).</summary>
    [GeneratedRegex("<link\\b[^>]*?\\srel\\s*=\\s*(?:\"apple-touch-icon\"|'apple-touch-icon'|apple-touch-icon(?=[\\s/>]))[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex TouchIconLink();

    /// <summary>jellyfin-web's theme colour: <c>&lt;meta id="themeColor"&gt;</c> or <c>&lt;meta name="theme-color"&gt;</c>.</summary>
    [GeneratedRegex("<meta\\b[^>]*?\\s(?:id\\s*=\\s*(?:\"themeColor\"|'themeColor'|themeColor(?=[\\s/>]))|name\\s*=\\s*(?:\"theme-color\"|'theme-color'|theme-color(?=[\\s/>])))[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex ThemeColorMeta();
}
