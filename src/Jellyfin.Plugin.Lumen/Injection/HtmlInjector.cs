namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>Adds Lumen's stylesheet and script to jellyfin-web's index.html. Pure and idempotent.</summary>
public static class HtmlInjector
{
    public const string Marker = "<!-- lumen:injected -->";

    // Relative to /web/ (or <BaseUrl>/web/), so "../Lumen" resolves to <BaseUrl>/Lumen.
    private const string AssetBase = "../Lumen/Assets/";

    // Runs synchronously before jellyfin-web paints: on routes Lumen may take over (see client takeover/routes.ts), it
    // hides the stock chrome until lumen.js (deferred) decides, so the stock header doesn't flash. lumen.js clears the
    // class once it knows; the timeout is a safety net if lumen.js never loads.
    private const string PendingGuard =
        """<script>(function(){try{var h=location.hash.replace(/^#!?/,'').toLowerCase(),q=h.indexOf('?'),"""
        + """p=q<0?h:h.slice(0,q),t=+((/[?&]tab=(\d+)/.exec(h)||[])[1]||0);"""
        + """if(p===''||p==='/'||p==='/details'||(p==='/home'&&t<2)||((p==='/movies'||p==='/tv')&&t===0)){"""
        + """var d=document.documentElement;d.classList.add('lmn-pending');"""
        + """setTimeout(function(){d.classList.remove('lmn-pending')},5000)}}catch(e){}})()</script>""";

    public static string Inject(string html, string buildHash)
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
        var tags = $"{Marker}{PendingGuard}<link rel=\"stylesheet\" href=\"{AssetBase}lumen.css?v={version}\">"
            + $"<script defer src=\"{AssetBase}lumen.js?v={version}\"></script>";

        return string.Concat(html.AsSpan(0, headClose), tags, html.AsSpan(headClose));
    }
}
