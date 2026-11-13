using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Health;
using MediaBrowser.Controller;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Health;

public class HealthServiceTests
{
    private readonly FakeTimeProvider _time = new(DateTimeOffset.Parse("2026-11-12T12:00:00Z", System.Globalization.CultureInfo.InvariantCulture));
    private readonly DiagnosticsStore _diagnostics = new();
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly IServerApplicationHost _host = Substitute.For<IServerApplicationHost>();

    public HealthServiceTests()
    {
        _config.Current.Returns(new PluginConfiguration { QuickConnectAddress = "https://tv.example.org" });
        _host.ApplicationVersionString.Returns("12.4.0");
    }

    [Fact]
    public async Task Report_RunsEveryCheck_InOrder_WithTheDevicesAndVersions()
    {
        _diagnostics.Record(new CompatReportDto { Client = "tv Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/68.0", ServerVersion = "12.4.0", FailedChecks = ["selector.upNext"] }, _time.GetUtcNow());

        var report = await Service(new FakeCheck("a"), new FakeCheck("b")).GetReportAsync(false, default);

        Assert.Equal(["a", "b"], report.Checks.Select(c => c.Id));
        Assert.Equal("12.4.0", report.JellyfinVersion);
        Assert.Equal("https://tv.example.org", report.QuickConnectAddress);
        Assert.Equal(["selector.upNext"], Assert.Single(report.Devices).FailedChecks);
        Assert.Equal(_time.GetUtcNow(), report.CheckedAt);
    }

    [Fact]
    public async Task Report_IsKeptForAMinute_UnlessAskedFresh()
    {
        var check = new FakeCheck("a");
        var service = Service(check);

        await service.GetReportAsync(false, default);
        _time.Advance(TimeSpan.FromSeconds(59));
        var cached = await service.GetReportAsync(false, default);
        Assert.Equal(1, check.Runs);
        Assert.Equal(_time.GetUtcNow().AddSeconds(-59), cached.CheckedAt);

        await service.GetReportAsync(true, default);
        Assert.Equal(2, check.Runs);
        Assert.True(check.LastFresh);
    }

    [Fact]
    public async Task ACheckThatHangs_IsCutOff_AndTheOthersStillReport()
    {
        // Real time here: the limit is the service's own (6 s), and a hang must not hold the others up.
        var hang = new FakeCheck("slow") { Hang = true };
        var service = new HealthService([hang, new FakeCheck("quick")], _diagnostics, _config, _host, TimeProvider.System, NullLogger<HealthService>.Instance);

        var started = DateTime.UtcNow;
        var report = await service.GetReportAsync(false, default);

        Assert.InRange(DateTime.UtcNow - started, TimeSpan.Zero, HealthService.CheckTimeout + TimeSpan.FromSeconds(3));
        Assert.Equal(HealthStatus.Warning, report.Checks[0].Status);
        Assert.Contains("didn't finish within 6 seconds", report.Checks[0].Message, StringComparison.Ordinal);
        Assert.Equal(HealthStatus.Ok, report.Checks[1].Status);
    }

    [Fact]
    public async Task ACheckThatThrows_BecomesAWarning()
    {
        var report = await Service(new FakeCheck("boom") { Throw = true }).GetReportAsync(false, default);

        var row = Assert.Single(report.Checks);
        Assert.Equal(HealthStatus.Warning, row.Status);
        Assert.Equal("Fake boom", row.Title);
    }

    private HealthService Service(params IHealthCheck[] checks) =>
        new(checks, _diagnostics, _config, _host, _time, NullLogger<HealthService>.Instance);

    private sealed class FakeCheck(string id) : IHealthCheck
    {
        public string Id => id;

        public string Group => HealthGroup.Server;

        public string Title => "Fake " + id;

        public bool Hang { get; init; }

        public bool Throw { get; init; }

        public int Runs { get; private set; }

        public bool LastFresh { get; private set; }

        public async Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
        {
            Runs++;
            LastFresh = fresh;
            if (Throw)
            {
                throw new InvalidOperationException("boom");
            }

            if (Hang)
            {
                // Ignores the token, like a call that doesn't take one.
                await Task.Delay(TimeSpan.FromSeconds(30), CancellationToken.None);
            }

            return this.Result(HealthStatus.Ok, "fine");
        }
    }
}
