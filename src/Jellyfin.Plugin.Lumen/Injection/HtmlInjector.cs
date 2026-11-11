using System.Net;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>Adds Lumen's stylesheet and script to jellyfin-web's index.html. Pure and idempotent.</summary>
public static partial class HtmlInjector
{
    public const string Marker = "<!-- lumen:injected -->";

    /// <summary>The client's inline guard bundle (client/src/veil/guard.ts).</summary>
    public const string GuardAsset = "lumen-guard.js";

    /// <summary>The client's ES5 definer of Lumen's jellyfin-web plugin (client/src/compat/webPluginDefiner.js).</summary>
    public const string WebPluginAsset = "lumen-web-plugin.js";

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
    /// anyone is signed in and so can't read Lumen's per-user client config, and links the admin pages' stylesheet
    /// (<c>lumen-dashboard.css</c>: the Dashboard, metadata manager and plugin settings pages, and jellyfin-web's dialogs
    /// and menus on every page).
    /// </param>
    /// <param name="installAsLumen">
    /// Makes a home-screen install Lumen's: points the web app manifest, Apple touch icon and theme colour at Lumen's, names
    /// it <paramref name="appName"/>, and has iOS run it full screen under a translucent status bar.
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
    /// <param name="webPluginScript">
    /// The definer of Lumen's jellyfin-web plugin (<see cref="WebConfigInjector"/>), inlined as a script of its own ahead
    /// of the guard: it's ES5, so it runs even in browsers that can't parse the guard. Null skips it.
    /// </param>
    /// <param name="appName">With <paramref name="installAsLumen"/>, the name under the home-screen icon (<see cref="AppIdentity.Name"/>).</param>
    public static string Inject(
        string html,
        string buildHash,
        string? guardScript = null,
        bool styleStockPages = false,
        bool installAsLumen = false,
        ICollection<string>? notFound = null,
        string? accentColor = null,
        string? coreChunk = null,
        string? webPluginScript = null,
        string appName = AppIdentity.DefaultName)
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
        var guard = InlineScript(webPluginScript) + InlineScript(script);
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
        return installAsLumen ? UseLumenAppIdentity(page, version, appName, notFound) : page;
    }

    /// <summary>
    /// Swaps jellyfin-web's manifest, touch icons and theme colour for Lumen's, and its home-screen app tags for Lumen's (only
    /// those tags). The tags are found whatever the order, quoting and case of their attributes; Lumen's manifest and theme
    /// colour take the place of the first match, and any further matches are removed.
    /// </summary>
    internal static string UseLumenAppIdentity(string html, string version, string appName, ICollection<string>? notFound = null)
    {
        html = ReplaceAll(html, ManifestLink(), "<link rel=\"manifest\" href=\"../Lumen/Manifest\">", "manifest link", notFound);
        html = ReplaceAll(html, TouchIconLink(), string.Empty, "apple-touch-icon link", notFound);

        // jellyfin-web sets #themeColor to its own theme's colour once it loads (#202020 for Dark), so Lumen's comes first:
        // browsers take the first theme-color. jellyfin-web's stays, for its script and anything else that reads it.
        html = ReplaceAll(
            html,
            ThemeColorMeta(),
            $"<meta name=\"theme-color\" content=\"{AppIdentity.Color}\"><meta id=\"themeColor\" name=\"theme-color\" content=\"{AppIdentity.Color}\">",
            "theme-color meta",
            notFound);

        // jellyfin-web names the app "Jellyfin" (application-name) and leaves iOS to title it from the page and keep an
        // opaque status bar. Black-translucent runs the page under the status bar, which only works where the page can
        // keep clear of it: viewport-fit=cover gives it env(safe-area-inset-top). Without that, an opaque black bar.
        var coverViewport = CoverViewport().IsMatch(html);
        html = AppMeta().Replace(html, string.Empty);
        var name = WebUtility.HtmlEncode(appName);
        var tags = "<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">"
            + $"<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"{(coverViewport ? "black-translucent" : "black")}\">"
            + $"<meta name=\"apple-mobile-web-app-title\" content=\"{name}\">"
            + $"<meta name=\"application-name\" content=\"{name}\">"
            + $"<link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"{AssetBase}lumen-icon-180.png?v={version}\">";
        var marker = html.IndexOf(Marker, StringComparison.Ordinal);
        return marker < 0 ? html : html.Insert(marker + Marker.Length, tags);
    }

    private static string InlineScript(string? script) => string.IsNullOrEmpty(script)
        ? string.Empty
        : "<script>" + script.Replace("</", "<\\/", StringComparison.Ordinal) + "</script>";

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

    /// <summary>The viewport meta asking for <c>viewport-fit=cover</c> (jellyfin-web's always has).</summary>
    [GeneratedRegex("<meta\\b[^>]*?\\sname\\s*=\\s*[\"']?viewport[\"']?[^>]*?viewport-fit\\s*=\\s*cover[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex CoverViewport();

    /// <summary>The home-screen app tags Lumen sets itself: removed from jellyfin-web's page first, so each appears once.</summary>
    [GeneratedRegex("<meta\\b[^>]*?\\sname\\s*=\\s*(?:\"(?:apple-mobile-web-app-(?:capable|status-bar-style|title)|application-name)\"|'(?:apple-mobile-web-app-(?:capable|status-bar-style|title)|application-name)'|(?:apple-mobile-web-app-(?:capable|status-bar-style|title)|application-name)(?=[\\s/>]))[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex AppMeta();

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
