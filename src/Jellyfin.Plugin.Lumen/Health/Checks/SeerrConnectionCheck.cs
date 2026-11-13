using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>Requests: Seerr is set up, answers, takes the saved key, and is linked to this server (Test connection's checks).</summary>
public sealed class SeerrConnectionCheck : IHealthCheck
{
    internal static readonly HealthFix OpenRequests = new("Open Requests settings", "setting", "requests");

    private readonly ILumenConfigReader _config;
    private readonly ISeerrClient _seerr;
    private readonly IServerApplicationHost _host;

    public SeerrConnectionCheck(ILumenConfigReader config, ISeerrClient seerr, IServerApplicationHost host)
    {
        _config = config;
        _seerr = seerr;
        _host = host;
    }

    public string Id => "requests.seerr";

    public string Group => HealthGroup.Requests;

    public string Title => "Seerr connection";

    public async Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        var config = _config.Current;
        if (!config.RequestsEnabled)
        {
            return this.Result(HealthStatus.NotApplicable, "Requests are off, so Lumen doesn't use Seerr.", OpenRequests);
        }

        if (SeerrEndpoint.From(config) is not { } endpoint)
        {
            return this.Result(HealthStatus.Problem, "Requests are on, but Seerr's address or API key isn't saved, so nobody can request anything.", OpenRequests);
        }

        var result = await SeerrConnectionTest.RunAsync(_seerr, endpoint, cancellationToken).ConfigureAwait(false);
        if (result.KeyRejected)
        {
            return this.Result(HealthStatus.Problem, "Seerr refused the saved API key. Copy it again from Seerr's Settings → General.", OpenRequests);
        }

        if (!result.Ok)
        {
            return this.Result(HealthStatus.Problem, "Lumen can't reach Seerr. " + HealthText.Scrub(result.Error!, endpoint.BaseUrl, "Seerr's address"), OpenRequests);
        }

        if (result.Server is { } server && !server.Is(_host.SystemId))
        {
            const string OtherServer = "Seerr answers and the key works, but Seerr is linked to a different Jellyfin server, so its "
                + "accounts and availability don't match this one. Link it to this server in Seerr's Settings → Jellyfin.";
            return this.Result(HealthStatus.Warning, OtherServer, OpenRequests);
        }

        return this.Result(HealthStatus.Ok, $"Seerr {result.Version} answers and the API key works.");
    }
}
