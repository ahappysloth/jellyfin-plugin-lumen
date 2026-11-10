using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Unicode;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// Lists Lumen's jellyfin-web plugin in jellyfin-web's <c>config.json</c>. Pure and idempotent.
/// <para>
/// jellyfin-web's pluginManager calls <c>window[name]()</c> for each listed name that's on <c>window</c> and hands the
/// class it returns its core services (the playback manager among them), before it renders. The inline guard defines
/// <see cref="PluginName"/> (client/src/compat/webPlugin.ts); a listed name that's not on <c>window</c> makes
/// jellyfin-web's plugin loading fail, so it's listed only alongside the guard (<see cref="IndexHtmlMiddleware"/>).
/// </para>
/// </summary>
public static class WebConfigInjector
{
    /// <summary>The plugin's name in <c>plugins</c> and on <c>window</c> (client/src/compat/webPlugin.ts WEB_PLUGIN_NAME).</summary>
    public const string PluginName = "LumenWebPlugin";

    private static readonly JsonSerializerOptions Output = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
    };

    /// <summary>
    /// <paramref name="json"/> with <see cref="PluginName"/> added to the end of its <c>plugins</c> array, everything else
    /// as it was. Returns <paramref name="json"/> itself when the plugin is already listed, and null when the file isn't
    /// an object with a <c>plugins</c> array (jellyfin-web then uses its built-in plugin list, which this must not
    /// replace) or isn't valid JSON.
    /// </summary>
    public static string? AddPlugin(string json)
    {
        try
        {
            if (JsonNode.Parse(json) is not JsonObject config || config["plugins"] is not JsonArray plugins)
            {
                return null;
            }

            if (plugins.Any(p => p is JsonValue value && value.GetValueKind() == JsonValueKind.String && value.GetValue<string>() == PluginName))
            {
                return json;
            }

            plugins.Add(PluginName);
            return config.ToJsonString(Output);
        }
        catch (Exception ex) when (ex is JsonException or ArgumentException or InvalidOperationException)
        {
            // Malformed, or duplicate keys (which JSON.parse would accept): leave the file to jellyfin-web.
            return null;
        }
    }
}
