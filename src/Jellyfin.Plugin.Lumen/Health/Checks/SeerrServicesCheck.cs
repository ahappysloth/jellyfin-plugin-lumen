using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>
/// Requests: Seerr hands approved requests to Radarr (movies) and Sonarr (shows). Without them nothing downloads, and
/// Lumen has no download progress to show.
/// </summary>
public sealed class SeerrServicesCheck : IHealthCheck
{
    private readonly ILumenConfigReader _config;
    private readonly ISeerrClient _seerr;

    public SeerrServicesCheck(ILumenConfigReader config, ISeerrClient seerr)
    {
        _config = config;
        _seerr = seerr;
    }

    public string Id => "requests.services";

    public string Group => HealthGroup.Requests;

    public string Title => "Radarr and Sonarr";

    public async Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        if (SeerrEndpoint.From(_config.Current) is not { } endpoint)
        {
            return this.Result(HealthStatus.NotApplicable, "Seerr isn't set up.");
        }

        SeerrServices services;
        try
        {
            services = await _seerr.GetServicesAsync(endpoint, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException)
        {
            // The connection row says why.
            return this.Result(HealthStatus.NotApplicable, "Couldn't ask Seerr which download apps it uses.");
        }

        const string Where = " Add them in Seerr's Settings → Services.";
        return (services.Radarr > 0, services.Sonarr > 0) switch
        {
            (true, true) => this.Result(HealthStatus.Ok, "Seerr sends movies to Radarr and shows to Sonarr, so Lumen can show download progress."),
            (true, false) => this.Result(HealthStatus.Warning, "Seerr has Radarr but no Sonarr server, so requested shows aren't downloaded and show no progress." + Where),
            (false, true) => this.Result(HealthStatus.Warning, "Seerr has Sonarr but no Radarr server, so requested movies aren't downloaded and show no progress." + Where),
            _ => this.Result(HealthStatus.Warning, "Seerr has no Radarr or Sonarr server, so approved requests aren't downloaded and Lumen can't show their progress." + Where),
        };
    }
}
