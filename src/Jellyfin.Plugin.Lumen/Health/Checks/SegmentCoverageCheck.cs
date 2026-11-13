namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>Skip Intro: how many episodes have an intro segment so far ("1,204 of 3,310 episodes").</summary>
public sealed class SegmentCoverageCheck : IHealthCheck
{
    private static readonly HealthFix OpenTasks = new("Open Scheduled Tasks", "dashboard", "tasks");

    private readonly IJellyfinFacts _jellyfin;

    public SegmentCoverageCheck(IJellyfinFacts jellyfin)
    {
        _jellyfin = jellyfin;
    }

    public string Id => "skipIntro.coverage";

    public string Group => HealthGroup.SkipIntro;

    public string Title => "Episodes with intros";

    public async Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        if (await _jellyfin.GetIntroCoverageAsync(cancellationToken).ConfigureAwait(false) is not { } coverage)
        {
            return this.Result(HealthStatus.NotApplicable, "Couldn't count intro segments on this Jellyfin version.");
        }

        if (coverage.Episodes == 0)
        {
            return this.Result(HealthStatus.NotApplicable, "There are no episodes yet.");
        }

        var counted = $"{coverage.WithIntro.ToString("N0", System.Globalization.CultureInfo.InvariantCulture)} of {HealthText.Plural(coverage.Episodes, "episode")} {(coverage.WithIntro == 1 ? "has an intro segment" : "have intro segments")}.";
        if (coverage.WithIntro > 0)
        {
            return this.Result(HealthStatus.Ok, counted);
        }

        if (_jellyfin.GetSegmentProviders().Count == 0)
        {
            // The plugins row above links to the setup guide.
            return this.Result(HealthStatus.NotApplicable, counted + " No plugin provides them yet.");
        }

        return this.Result(
            HealthStatus.Warning,
            counted + " The plugins find intros in scheduled tasks after a library scan: check they've run in Dashboard → Scheduled Tasks.",
            OpenTasks);
    }
}
