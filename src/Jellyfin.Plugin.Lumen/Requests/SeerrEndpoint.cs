using System.Globalization;
using Jellyfin.Plugin.Lumen.Configuration;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Where and how to reach Seerr: base URL plus the admin API key.</summary>
public sealed record SeerrEndpoint(Uri BaseUrl, string ApiKey)
{
    /// <summary>
    /// Identifies this endpoint (address and key) in in-memory cache keys, so changing either in the dashboard takes
    /// effect immediately. Holds only a per-process hash of the key, never the key itself.
    /// </summary>
    public string CacheKey => BaseUrl + "#" + ApiKey.GetHashCode(StringComparison.Ordinal).ToString(CultureInfo.InvariantCulture);

    /// <summary>The configured endpoint, or null when requests are off or not fully configured.</summary>
    public static SeerrEndpoint? From(PluginConfiguration config) =>
        config.RequestsEnabled && ConfigValidator.IsHttpUrl(config.SeerrUrl) && !string.IsNullOrWhiteSpace(config.SeerrApiKey)
            ? new SeerrEndpoint(new Uri(config.SeerrUrl!.TrimEnd('/') + "/"), config.SeerrApiKey!)
            : null;

    /// <summary>Redacts the key, so logging or dumping an endpoint (or a record holding one) never prints it.</summary>
    public override string ToString() => "SeerrEndpoint { BaseUrl = " + BaseUrl + ", ApiKey = *** }";
}
