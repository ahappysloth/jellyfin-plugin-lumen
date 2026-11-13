namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>
/// Skip Intro: each TV library lets the segment providers run (library options → "Media segment providers"). One unticked
/// there gets no segments from it in that library.
/// </summary>
public sealed class SegmentLibrariesCheck : IHealthCheck
{
    private static readonly HealthFix OpenLibraries = new("Open Libraries", "dashboard", "libraries");

    private readonly IJellyfinFacts _jellyfin;

    public SegmentLibrariesCheck(IJellyfinFacts jellyfin)
    {
        _jellyfin = jellyfin;
    }

    public string Id => "skipIntro.libraries";

    public string Group => HealthGroup.SkipIntro;

    public string Title => "Segment providers in libraries";

    public Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        var providers = _jellyfin.GetSegmentProviders();
        if (providers.Count == 0)
        {
            return Task.FromResult(this.Result(HealthStatus.NotApplicable, "No plugin provides media segments yet."));
        }

        // Shows and mixed libraries: where episodes (and so intros) are.
        var libraries = _jellyfin.GetLibraries()
            .Where(l => l.CollectionType is null || l.CollectionType.Equals("tvshows", StringComparison.OrdinalIgnoreCase) || l.CollectionType.Equals("mixed", StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (libraries.Count == 0)
        {
            return Task.FromResult(this.Result(HealthStatus.NotApplicable, "There's no TV library."));
        }

        bool Off(LibrarySegmentOptions library, string provider) =>
            library.DisabledSegmentProviders.Contains(provider, StringComparer.OrdinalIgnoreCase);

        var allOff = libraries.Where(l => providers.All(p => Off(l, p))).Select(l => l.Name).ToList();
        var offs = providers
            .Select(p => (Provider: p, Libraries: libraries.Where(l => Off(l, p)).Select(l => l.Name).ToList()))
            .Where(o => o.Libraries.Count > 0)
            .ToList();
        var detail = string.Join(" ", offs.Select(o => $"{o.Provider} is off in {HealthText.List(o.Libraries)}."));
        const string How = " Turn it on in each library's options, under Media segment providers.";
        if (allOff.Count > 0)
        {
            return Task.FromResult(this.Result(
                HealthStatus.Problem,
                $"No segment provider runs in {HealthText.List(allOff)}, so {(allOff.Count == 1 ? "its" : "their")} episodes get no Skip Intro. {detail}{How}",
                OpenLibraries));
        }

        if (offs.Count > 0)
        {
            return Task.FromResult(this.Result(HealthStatus.Warning, detail + How, OpenLibraries));
        }

        return Task.FromResult(this.Result(
            HealthStatus.Ok,
            $"{HealthText.List(providers)} {(providers.Count == 1 ? "is" : "are")} on in {(libraries.Count == 1 ? "your TV library" : $"all {libraries.Count} TV libraries")}."));
    }
}
