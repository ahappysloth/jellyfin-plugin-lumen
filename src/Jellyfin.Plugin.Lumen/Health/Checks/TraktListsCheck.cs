using Jellyfin.Plugin.Lumen.Trakt;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>Trakt: how the latest fetch of a Trakt list went, and when (from <see cref="ITraktLists"/>' cache).</summary>
public sealed class TraktListsCheck : IHealthCheck
{
    private readonly ITraktLists _lists;
    private readonly TimeProvider _time;

    public TraktListsCheck(ITraktLists lists, TimeProvider time)
    {
        _lists = lists;
        _time = time;
    }

    public string Id => "trakt.lists";

    public string Group => HealthGroup.Trakt;

    public string Title => "Trakt lists";

    public Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        if (!_lists.Enabled)
        {
            return Task.FromResult(this.Result(HealthStatus.NotApplicable, "No Trakt key is saved."));
        }

        if (_lists.LastFetch is not { } fetch)
        {
            return Task.FromResult(this.Result(
                HealthStatus.NotApplicable,
                "No Trakt list has loaded since Jellyfin started. Lists load when someone opens Home or Top charts."));
        }

        var ago = HealthText.Ago(fetch.At, _time.GetUtcNow());
        if (fetch.Error is null)
        {
            return Task.FromResult(this.Result(HealthStatus.Ok, $"The last Trakt list loaded {ago}."));
        }

        var failed = $"The last Trakt list fetch failed {ago}: {HealthText.Scrub(fetch.Error)}";
        var retry = $" Lumen tries again every {TraktLists.RetryAfter.TotalMinutes:0} minutes.";
        return Task.FromResult(fetch.HasCopy
            ? this.Result(HealthStatus.Warning, failed + " Lumen shows its last copy meanwhile." + retry)
            : this.Result(HealthStatus.Problem, failed + " The rows that use it are hidden (the Top 10 rows use Seerr's trending list) until it works." + retry));
    }
}
