using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>
/// What the Notifications rows share: push notifications come with requests (there's no switch of their own), so with
/// requests off or Seerr not set up there's nothing to check.
/// </summary>
internal static class PushRows
{
    internal static readonly HealthFix OpenRequests = SeerrConnectionCheck.OpenRequests;

    /// <summary>Why the rows don't apply, or null when they do.</summary>
    internal static string? Off(PluginConfiguration config) =>
        !config.RequestsEnabled ? "Notifications come with requests, which are off."
        : SeerrEndpoint.From(config) is null ? "Notifications come with requests, and Seerr isn't set up yet."
        : null;
}
