using Jellyfin.Plugin.Lumen.Configuration;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>
/// Quick Connect: the "Public address for QR codes" (Settings → General). Its value stays out of the message, which the
/// copied report repeats; the page shows it from the settings it already has, and checks it answers.
/// </summary>
public sealed class QuickConnectAddressCheck : IHealthCheck
{
    private static readonly HealthFix OpenGeneral = new("Open General settings", "setting", "general");

    private readonly ILumenConfigReader _config;
    private readonly IJellyfinFacts _jellyfin;

    public QuickConnectAddressCheck(ILumenConfigReader config, IJellyfinFacts jellyfin)
    {
        _config = config;
        _jellyfin = jellyfin;
    }

    public string Id => "quickConnect.address";

    public string Group => HealthGroup.QuickConnect;

    public string Title => "Public address for QR codes";

    public Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        if (!_jellyfin.QuickConnectEnabled)
        {
            return Task.FromResult(this.Result(HealthStatus.NotApplicable, "Quick Connect is off."));
        }

        const string NotSet = "Not set, so QR codes send phones to the address the TV or browser signing in uses. Set one if "
            + "that's a local address (localhost, or a LAN address phones away from home can't reach).";
        return Task.FromResult(string.IsNullOrWhiteSpace(_config.Current.QuickConnectAddress)
            ? this.Result(HealthStatus.Ok, NotSet, OpenGeneral)
            : this.Result(HealthStatus.Ok, "Set: QR codes send phones to the public address in Settings → General.", OpenGeneral));
    }
}
