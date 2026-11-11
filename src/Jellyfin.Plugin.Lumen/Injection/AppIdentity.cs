using Jellyfin.Plugin.Lumen.Configuration;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// What the web client is called and looks like when it's added to a home screen while Lumen is on: the name and colour
/// that index.html's tags (<see cref="HtmlInjector"/>) and the web app manifest (<c>/Lumen/Manifest</c>) both give.
/// </summary>
public static class AppIdentity
{
    /// <summary>The name under the home-screen icon, unless the admin picks the server's.</summary>
    public const string DefaultName = "Lumen";

    /// <summary>Lumen's page background (<c>--lmn-bg</c>): the installed app's launch background and theme colour.</summary>
    public const string Color = "#0f0f0f";

    /// <summary>
    /// The installed app's name: the server's when the admin asks for it and it has one, else <see cref="DefaultName"/>.
    /// </summary>
    public static string Name(PluginConfiguration? config, string? serverName) =>
        config is { AppNameFromServer: true } && !string.IsNullOrWhiteSpace(serverName) ? serverName.Trim() : DefaultName;
}
