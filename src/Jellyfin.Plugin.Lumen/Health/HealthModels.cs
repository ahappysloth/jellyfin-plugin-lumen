using Jellyfin.Plugin.Lumen.Diagnostics;

namespace Jellyfin.Plugin.Lumen.Health;

/// <summary>
/// A check's outcome. Strings rather than an enum, so the JSON reads the same whatever enum handling Jellyfin's
/// serializer has.
/// </summary>
public static class HealthStatus
{
    public const string Ok = "Ok";
    public const string Warning = "Warning";
    public const string Problem = "Problem";

    /// <summary>The check doesn't apply here (the feature is off, or there's nothing to check yet).</summary>
    public const string NotApplicable = "NotApplicable";
}

/// <summary>The Health tab's groups, in the order the page shows them (the client keeps the same order).</summary>
public static class HealthGroup
{
    public const string Server = "Server";
    public const string Proxy = "Proxy";
    public const string Requests = "Requests";
    public const string Trakt = "Trakt";
    public const string SkipIntro = "SkipIntro";
    public const string QuickConnect = "QuickConnect";
}

/// <summary>
/// Where a check's fix is. <paramref name="Kind"/> is <c>dashboard</c> (a Jellyfin dashboard page, by a key the client
/// maps to jellyfin-web's route), <c>setting</c> (a card on Lumen's Settings tab, by its key) or <c>help</c> (a help
/// page, by its key). Keys rather than URLs: the client owns jellyfin-web's routes (compat/registry.ts) and the links.
/// </summary>
public sealed record HealthFix(string Label, string Kind, string Target);

/// <summary>
/// One check's result. <paramref name="Message"/> is plain words for the admin, and also goes into the page's Copy report,
/// so it must never hold a secret, an address or a hostname.
/// </summary>
public sealed record HealthCheckResult(string Id, string Group, string Status, string Title, string Message, HealthFix? Fix = null);

/// <summary>Everything the Health tab shows from the server (GET /Lumen/Admin/Health).</summary>
/// <param name="CheckedAt">When these checks ran (a cached copy keeps its time).</param>
/// <param name="LumenVersion">The running Lumen version.</param>
/// <param name="JellyfinVersion">The server's version.</param>
/// <param name="Checks">The server-side checks, in the order they're registered.</param>
/// <param name="Devices">Today's compatibility failures, newest first.</param>
/// <param name="QuickConnectAddress">The saved "Public address for QR codes" (empty when not set), for the page's reachability check.</param>
public sealed record HealthReportDto(
    DateTimeOffset CheckedAt,
    string LumenVersion,
    string JellyfinVersion,
    IReadOnlyList<HealthCheckResult> Checks,
    IReadOnlyList<DiagnosticEntry> Devices,
    string QuickConnectAddress);
