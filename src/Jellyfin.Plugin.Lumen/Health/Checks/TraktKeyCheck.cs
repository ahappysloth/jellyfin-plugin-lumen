using System.Net;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Trakt;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>Trakt: a key is saved and Trakt takes it (the Trakt card's Check key, with the saved key).</summary>
public sealed class TraktKeyCheck : IHealthCheck
{
    internal static readonly HealthFix OpenTrakt = new("Open Trakt settings", "setting", "trakt");

    private readonly ILumenConfigReader _config;
    private readonly ITraktClient _trakt;

    public TraktKeyCheck(ILumenConfigReader config, ITraktClient trakt)
    {
        _config = config;
        _trakt = trakt;
    }

    public string Id => "trakt.key";

    public string Group => HealthGroup.Trakt;

    public string Title => "Trakt key";

    public async Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        var key = _config.Current.TraktClientId;
        if (string.IsNullOrWhiteSpace(key))
        {
            return this.Result(
                HealthStatus.NotApplicable,
                "No Trakt key is saved. The Top 10 rows use Seerr's trending list instead, and Top charts and the Trakt rows are hidden.",
                OpenTrakt);
        }

        if (!ConfigValidator.IsTraktKey(key))
        {
            return this.Result(HealthStatus.Problem, "The saved Trakt key doesn't look like a Trakt Client ID.", OpenTrakt);
        }

        try
        {
            await _trakt.GetTitlesAsync(key, TraktQuery.Watched(TraktListKind.Movies, TraktPeriod.Weekly) with { Limit = 1 }, cancellationToken).ConfigureAwait(false);
            return this.Result(HealthStatus.Ok, "Trakt takes the saved key.");
        }
        catch (TraktException e) when (e.Status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
        {
            return this.Result(HealthStatus.Problem, "Trakt refused the saved key. Use the Client ID of an app from trakt.tv/oauth/applications.", OpenTrakt);
        }
        catch (TraktException e)
        {
            return this.Result(HealthStatus.Warning, "Couldn't check the key: " + HealthText.Scrub(e.Message));
        }
    }
}
