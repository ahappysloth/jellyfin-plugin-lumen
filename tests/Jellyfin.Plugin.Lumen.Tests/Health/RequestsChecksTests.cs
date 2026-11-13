using System.Net;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Health;
using Jellyfin.Plugin.Lumen.Health.Checks;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Health;

public class RequestsChecksTests
{
    private const string SystemId = "8d3c1f5e2b0a4c6d9e7f1a2b3c4d5e6f";
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly IServerApplicationHost _host = Substitute.For<IServerApplicationHost>();

    public RequestsChecksTests()
    {
        _host.SystemId.Returns(SystemId);
        _config.Current.Returns(new PluginConfiguration { RequestsEnabled = true, SeerrUrl = "http://seerr.home.example:5055", SeerrApiKey = "secret-key" });
        _seerr.GetStatusAsync(default!, default).ReturnsForAnyArgs(new SeerrStatus("2.7.3"));
        _seerr.GetJellyfinServerAsync(default!, default).ReturnsForAnyArgs(new SeerrJellyfinServer("Home", SystemId));
    }

    [Fact]
    public async Task Seerr_RequestsOff_IsNotApplicable_AndAsksNothing()
    {
        _config.Current.Returns(new PluginConfiguration { RequestsEnabled = false, SeerrUrl = "http://seerr:5055", SeerrApiKey = "k" });

        var result = await Connection().RunAsync(false, default);

        Assert.Equal(HealthStatus.NotApplicable, result.Status);
        Assert.Equal(new HealthFix("Open Requests settings", "setting", "requests"), result.Fix);
        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Fact]
    public async Task Seerr_OnWithoutAKey_IsAProblem()
    {
        _config.Current.Returns(new PluginConfiguration { RequestsEnabled = true, SeerrUrl = "http://seerr:5055" });

        var result = await Connection().RunAsync(false, default);

        Assert.Equal(HealthStatus.Problem, result.Status);
        Assert.Contains("isn't saved", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Seerr_AnswersAndTakesTheKey_IsOk()
    {
        var result = await Connection().RunAsync(false, default);

        Assert.Equal(HealthStatus.Ok, result.Status);
        Assert.Equal("Seerr 2.7.3 answers and the API key works.", result.Message);
        await _seerr.Received(1).GetUserByJellyfinIdForAdminAsync(Arg.Any<SeerrEndpoint>(), Guid.Empty, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Seerr_RefusingTheKey_IsAProblem()
    {
        _seerr.GetUserByJellyfinIdForAdminAsync(default!, default, default).ThrowsAsyncForAnyArgs(new SeerrException("Seerr rejected the API key.", HttpStatusCode.Forbidden));

        var result = await Connection().RunAsync(false, default);

        Assert.Equal(HealthStatus.Problem, result.Status);
        Assert.Contains("refused the saved API key", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Seerr_Unreachable_IsAProblem_WithoutNamingItsAddress()
    {
        _seerr.GetStatusAsync(default!, default).ThrowsAsyncForAnyArgs(
            new SeerrException("Couldn't reach Seerr: Connection refused (seerr.home.example:5055)"));

        var result = await Connection().RunAsync(false, default);

        Assert.Equal(HealthStatus.Problem, result.Status);
        Assert.StartsWith("Lumen can't reach Seerr. Couldn't reach Seerr: Connection refused", result.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("seerr.home.example", result.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("5055", result.Message, StringComparison.Ordinal);
        Assert.EndsWith("Connection refused (Seerr's address)", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Seerr_LinkedToAnotherJellyfin_Warns()
    {
        _seerr.GetJellyfinServerAsync(default!, default).ReturnsForAnyArgs(new SeerrJellyfinServer("Elsewhere", "00000000000000000000000000000001"));

        var result = await Connection().RunAsync(false, default);

        Assert.Equal(HealthStatus.Warning, result.Status);
        Assert.DoesNotContain("Elsewhere", result.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(1, 1, HealthStatus.Ok, "sends movies to Radarr and shows to Sonarr")]
    [InlineData(2, 0, HealthStatus.Warning, "no Sonarr server")]
    [InlineData(0, 1, HealthStatus.Warning, "no Radarr server")]
    [InlineData(0, 0, HealthStatus.Warning, "no Radarr or Sonarr server")]
    public async Task Services_CountsRadarrAndSonarr(int radarr, int sonarr, string status, string says)
    {
        _seerr.GetServicesAsync(default!, default).ReturnsForAnyArgs(new SeerrServices(radarr, sonarr));

        var result = await new SeerrServicesCheck(_config, _seerr).RunAsync(false, default);

        Assert.Equal(status, result.Status);
        Assert.Contains(says, result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Services_WithoutSeerr_OrWhenSeerrFails_IsNotApplicable()
    {
        _seerr.GetServicesAsync(default!, default).ThrowsAsyncForAnyArgs(new SeerrException("Seerr did not answer within 5 seconds."));
        Assert.Equal(HealthStatus.NotApplicable, (await new SeerrServicesCheck(_config, _seerr).RunAsync(false, default)).Status);

        _config.Current.Returns(new PluginConfiguration());
        Assert.Equal(HealthStatus.NotApplicable, (await new SeerrServicesCheck(_config, _seerr).RunAsync(false, default)).Status);
    }

    private SeerrConnectionCheck Connection() => new(_config, _seerr, _host);
}
