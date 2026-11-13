namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>Quick Connect: on in Dashboard → General (the sign-in page's code and QR code need it).</summary>
public sealed class QuickConnectCheck : IHealthCheck
{
    private readonly IJellyfinFacts _jellyfin;

    public QuickConnectCheck(IJellyfinFacts jellyfin)
    {
        _jellyfin = jellyfin;
    }

    public string Id => "quickConnect.enabled";

    public string Group => HealthGroup.QuickConnect;

    public string Title => "Quick Connect";

    public Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken) =>
        Task.FromResult(_jellyfin.QuickConnectEnabled
            ? this.Result(HealthStatus.Ok, "Quick Connect is on: the sign-in page shows a code and a QR code to approve from a signed-in phone.")
            : this.Result(
                HealthStatus.NotApplicable,
                "Quick Connect is off, so the sign-in page has no code or QR code. Turn it on in Dashboard → General if you want them.",
                new HealthFix("Open General", "dashboard", "general")));
}
