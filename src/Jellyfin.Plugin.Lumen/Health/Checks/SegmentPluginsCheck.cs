namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>
/// Skip Intro: a plugin that finds intros is installed. Jellyfin has no intro segments of its own; Intro Skipper detects
/// them in the audio, and SkipMe.db fetches times others have marked.
/// </summary>
public sealed class SegmentPluginsCheck : IHealthCheck
{
    internal static readonly HealthFix SetupGuide = new("Skip Intro setup guide", "help", "skipIntro");

    private static readonly HealthFix OpenPlugins = new("Open Plugins", "dashboard", "plugins");

    /// <summary>
    /// The plugins, by id (from their manifests: intro-skipper.org/manifest.json lists both), with names as a fallback for a
    /// fork or a build under another id.
    /// </summary>
    private static readonly (string Name, Guid Id, string[] Matches)[] Known =
    [
        ("Intro Skipper", Guid.Parse("c83d86bb-a1e0-4c35-a113-e2101cf4ee6b"), ["intro skipper", "introskipper"]),
        ("SkipMe.db", Guid.Parse("b2a63e62-0ac5-4575-9ad2-2c7534ccb83d"), ["skipme"]),
    ];

    /// <summary>Of several copies of a plugin, the one that counts: a running one before a broken one, and an old one last.</summary>
    private static readonly string[] StatusOrder = ["Active", "Restart", "Disabled", "NotSupported", "Malfunctioned", "Superseded", "Deleted"];

    private readonly IJellyfinFacts _jellyfin;

    public SegmentPluginsCheck(IJellyfinFacts jellyfin)
    {
        _jellyfin = jellyfin;
    }

    public string Id => "skipIntro.plugins";

    public string Group => HealthGroup.SkipIntro;

    public string Title => "Intro Skipper and SkipMe.db";

    public Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        var plugins = _jellyfin.GetPlugins();
        var found = Known
            .Select(k => (k.Name, Plugin: Find(plugins, k.Id, k.Matches)))
            .Where(k => k.Plugin is not null)
            .ToList();

        var broken = found.Where(f => f.Plugin!.Status is not ("Active" or "Restart")).ToList();
        if (broken.Count > 0)
        {
            var (name, plugin) = broken[0];
            var why = plugin!.Status switch
            {
                "Disabled" => "is disabled",
                "NotSupported" => "doesn't support this Jellyfin version",
                "Malfunctioned" => "failed to load",
                _ => "isn't running (" + plugin.Status + ")",
            };
            return Task.FromResult(this.Result(HealthStatus.Problem, $"{name} is installed but {why}, so it finds no intros. Update or re-enable it on the Plugins page.", OpenPlugins));
        }

        var waiting = found.Where(f => f.Plugin!.Status == "Restart").Select(f => f.Name).ToList();
        if (waiting.Count > 0)
        {
            return Task.FromResult(this.Result(HealthStatus.Warning, $"{HealthText.List(waiting)} starts working when Jellyfin restarts.", OpenPlugins));
        }

        if (found.Count == 0)
        {
            var others = _jellyfin.GetSegmentProviders();
            return Task.FromResult(others.Count > 0
                ? this.Result(HealthStatus.Ok, $"Neither is installed, but {HealthText.List(others)} provides media segments.", SetupGuide)
                : this.Result(
                    HealthStatus.Warning,
                    "Neither Intro Skipper nor SkipMe.db is installed. Jellyfin only knows where intros are (and shows Skip Intro) when a plugin finds them.",
                    SetupGuide));
        }

        var names = found.Select(f => f.Name).ToList();
        var missing = Known.Select(k => k.Name).Except(names).ToList();
        return Task.FromResult(this.Result(
            HealthStatus.Ok,
            $"{HealthText.List(names)} {(names.Count == 1 ? "is" : "are")} installed." + (missing.Count > 0 ? $" {missing[0]} is optional: it adds to what {names[0]} finds." : string.Empty),
            SetupGuide));
    }

    /// <summary>
    /// The copy of a plugin that says how it stands: an update leaves the old version beside the new one (Superseded), and
    /// a removed one stays listed (Deleted) until Jellyfin restarts. Matched by id; by name only when no copy has the id.
    /// A plugin whose only copies are being removed counts as not installed.
    /// </summary>
    private static InstalledPlugin? Find(IReadOnlyList<InstalledPlugin> plugins, Guid id, string[] matches)
    {
        var copies = plugins.Where(p => p.Id == id).ToList();
        if (copies.Count == 0)
        {
            copies = plugins.Where(p => matches.Any(m => p.Name.Contains(m, StringComparison.OrdinalIgnoreCase))).ToList();
        }

        static int Rank(string status) => Array.IndexOf(StatusOrder, status) is var at and >= 0 ? at : StatusOrder.Length;
        var best = copies.OrderBy(p => Rank(p.Status)).ThenByDescending(p => p.Version).FirstOrDefault();
        return best?.Status == "Deleted" ? null : best;
    }
}
