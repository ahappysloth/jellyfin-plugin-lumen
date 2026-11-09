namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>Adds Lumen's stylesheet and script to jellyfin-web's index.html. Pure and idempotent.</summary>
public static class HtmlInjector
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
    public static string Inject(string html, string buildHash, string? guardScript = null, bool styleStockPages = false)
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

        return string.Concat(html.AsSpan(0, headClose), tags, html.AsSpan(headClose));
    }
}
