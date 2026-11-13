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
    public async Task Report_IsNotKept_PastASave_OrAnInvalidate()
    {
        var check = new FakeCheck("a");
        var service = Service(check);

        await service.GetReportAsync(false, default);
        _config.Current.Returns(new PluginConfiguration { ConfigVersion = 1 });
        await service.GetReportAsync(false, default);
        Assert.Equal(2, check.Runs);
        Assert.False(check.LastFresh);

        await service.GetReportAsync(false, default);
        Assert.Equal(2, check.Runs);
        service.Invalidate();
        await service.GetReportAsync(false, default);
        Assert.Equal(3, check.Runs);
    }

    [Fact]
    public async Task ASupersededRun_FinishingLast_DoesntReplaceTheNewerReport()
    {
        var check = new GatedCheck();
        var service = Service(check);

        // A cached-allowed run starts, then "Run checks again" starts a fresh one beside it; the fresh one ends first.
        var older = service.GetReportAsync(false, default);
        var newer = service.GetReportAsync(true, default);
        check.Fresh.SetResult();
        Assert.Equal("fresh", (await newer).Checks[0].Message);
        check.Stale.SetResult();
        Assert.Equal("stale", (await older).Checks[0].Message);

        var kept = await service.GetReportAsync(false, default);
        Assert.Equal("fresh", kept.Checks[0].Message);
        Assert.Equal(2, check.Runs);
    }

    [Fact]
    public async Task ACheck_GetsItsOwnTimeLimit()
    {
        var service = new HealthService(
            [new FakeCheck("short") { Hang = true, TimeLimit = TimeSpan.FromSeconds(2) }],
            _diagnostics,
            _config,
            _host,
            TimeProvider.System,
            NullLogger<HealthService>.Instance);

        var started = DateTime.UtcNow;
        var row = Assert.Single((await service.GetReportAsync(false, default)).Checks);

        Assert.InRange(DateTime.UtcNow - started, TimeSpan.Zero, HealthService.CheckTimeout - TimeSpan.FromSeconds(1));
        Assert.Contains("didn't finish within 2 seconds", row.Message, StringComparison.Ordinal);
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

        public TimeSpan TimeLimit { get; init; } = HealthService.CheckTimeout;

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

    /// <summary>A check that waits to be let go: a cached-allowed run on <see cref="Stale"/>, a fresh one on <see cref="Fresh"/>.</summary>
    private sealed class GatedCheck : IHealthCheck
    {
        private int _runs;

        public string Id => "gated";

        public string Group => HealthGroup.Server;

        public string Title => "Gated";

        public TaskCompletionSource Stale { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource Fresh { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public int Runs => Volatile.Read(ref _runs);

        public async Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _runs);
            await (fresh ? Fresh : Stale).Task.ConfigureAwait(false);
            return this.Result(HealthStatus.Ok, fresh ? "fresh" : "stale");
        }
    }
}
