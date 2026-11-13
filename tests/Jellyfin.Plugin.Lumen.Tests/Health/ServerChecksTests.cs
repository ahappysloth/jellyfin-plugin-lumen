using Jellyfin.Plugin.Lumen.Health;
using Jellyfin.Plugin.Lumen.Health.Checks;
using Jellyfin.Plugin.Lumen.Updates;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Health;

public class ServerChecksTests
{
    private readonly IJellyfinFacts _jellyfin = Substitute.For<IJellyfinFacts>();
    private readonly FakeTimeProvider _time = new(DateTimeOffset.Parse("2026-11-12T12:00:00Z", System.Globalization.CultureInfo.InvariantCulture));

    [Fact]
    public async Task Update_UpToDate_IsOk()
    {
        var result = await Update(Status("0.5.0", "0.5.0")).RunAsync(false, default);

        Assert.Equal(HealthStatus.Ok, result.Status);
        Assert.Equal("Lumen 0.5.0 is the latest version.", result.Message);
        Assert.Null(result.Fix);
    }

    [Fact]
    public async Task Update_Available_WarnsAndLinksToTheUpdatesCard()
    {
        var result = await Update(Status("0.5.0", "0.5.1", available: true)).RunAsync(false, default);

        Assert.Equal(HealthStatus.Warning, result.Status);
        Assert.Equal("Lumen 0.5.1 is available. This server has 0.5.0.", result.Message);
        Assert.Equal(new HealthFix("Open Updates", "setting", "updates"), result.Fix);
    }

    [Fact]
    public async Task Update_InstalledAndWaitingForARestart_Warns()
    {
        var result = await Update(Status("0.5.0", "0.5.1", pending: true)).RunAsync(false, default);

        Assert.Equal(HealthStatus.Warning, result.Status);
        Assert.Contains("starts when Jellyfin restarts", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Update_GitHubUnreachable_IsNotApplicable()
    {
        var result = await Update(Status("0.5.0", null, reachable: false)).RunAsync(false, default);

        Assert.Equal(HealthStatus.NotApplicable, result.Status);
        Assert.Contains("GitHub didn't answer", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Update_IsKeptForAnHour_UnlessAskedFresh()
    {
        var calls = 0;
        var check = new LumenUpdateCheck(_ => Task.FromResult(Status("0.5.0", $"0.5.{++calls}", available: true)), _time);

        await check.RunAsync(false, default);
        _time.Advance(TimeSpan.FromMinutes(59));
        Assert.Contains("0.5.1", (await check.RunAsync(false, default)).Message, StringComparison.Ordinal);
        Assert.Contains("0.5.2", (await check.RunAsync(true, default)).Message, StringComparison.Ordinal);
        _time.Advance(TimeSpan.FromHours(1));
        Assert.Contains("0.5.3", (await check.RunAsync(false, default)).Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CustomCss_None_IsOk()
    {
        _jellyfin.BrandingCustomCss.Returns("  \n");

        var result = await new CustomCssCheck(_jellyfin).RunAsync(false, default);

        Assert.Equal(HealthStatus.Ok, result.Status);
        Assert.Null(result.Fix);
    }

    [Fact]
    public async Task CustomCss_Set_WarnsThatItStylesLumenToo_AndLinksToBranding()
    {
        _jellyfin.BrandingCustomCss.Returns(".skinHeader { background: red; }");

        var result = await new CustomCssCheck(_jellyfin).RunAsync(false, default);

        Assert.Equal(HealthStatus.Warning, result.Status);
        Assert.Contains("Lumen's pages too", result.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("@import", result.Message, StringComparison.Ordinal);
        Assert.Equal(new HealthFix("Open Branding", "dashboard", "branding"), result.Fix);
    }

    [Fact]
    public async Task CustomCss_CountsStylesheetsImportedFromOtherSites()
    {
        // Ultrachromic's way: a list of @imports from a CDN. A local one (same server) doesn't hold up the start the same way.
        _jellyfin.BrandingCustomCss.Returns(
            """
            @import url('https://cdn.jsdelivr.net/gh/CTalvio/Ultrachromic/base.css');
            @import url("https://cdn.jsdelivr.net/gh/CTalvio/Ultrachromic/fields/fields_border.css");
            @import "//fonts.example.com/font.css";
            @import url('/web/local.css');
            """);

        var result = await new CustomCssCheck(_jellyfin).RunAsync(false, default);

        Assert.Contains("loads 3 stylesheets from other sites", result.Message, StringComparison.Ordinal);
    }

    private static UpdateStatusDto Status(string installed, string? latest, bool available = false, bool pending = false, bool reachable = true) =>
        new(installed, latest, null, available, reachable, false, pending);

    private LumenUpdateCheck Update(UpdateStatusDto status) => new(_ => Task.FromResult(status), _time);
}
