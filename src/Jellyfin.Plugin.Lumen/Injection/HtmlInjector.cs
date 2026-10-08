namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>Adds Lumen's stylesheet and script to jellyfin-web's index.html. Pure and idempotent.</summary>
public static class HtmlInjector
{
    public const string Marker = "<!-- lumen:injected -->";

    // Relative to /web/ (or <BaseUrl>/web/), so "../Lumen" resolves to <BaseUrl>/Lumen.
    private const string AssetBase = "../Lumen/Assets/";

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
        var tags = $"{Marker}<link rel=\"stylesheet\" href=\"{AssetBase}lumen.css?v={version}\">"
            + $"<script defer src=\"{AssetBase}lumen.js?v={version}\"></script>";

        return string.Concat(html.AsSpan(0, headClose), tags, html.AsSpan(headClose));
    }
}
