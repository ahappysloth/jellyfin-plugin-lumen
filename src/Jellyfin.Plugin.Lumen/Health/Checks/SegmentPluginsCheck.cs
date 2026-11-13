namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>
/// Skip Intro: a plugin that finds intros is installed. Jellyfin has no intro segments of its own; Intro Skipper detects
/// them in the audio, and SkipMe.db fetches times others have marked.
/// </summary>
public sealed class SegmentPluginsCheck : IHealthCheck
{
    internal static readonly HealthFix SetupGuide = new("Skip Intro setup guide", "help", "skipIntro");

    private static readonly HealthFix OpenPlugins = new("Open Plugins", "dashboard", "plugins");

    private static readonly (string Name, string[] Matches)[] Known =
    [
        ("Intro Skipper", ["intro skipper", "introskipper"]),
        ("SkipMe.db", ["skipme"]),
    ];

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
            .Select(k => (k.Name, Plugin: plugins.FirstOrDefault(p => k.Matches.Any(m => p.Name.Contains(m, StringComparison.OrdinalIgnoreCase)))))
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
}
