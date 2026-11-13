using System.Net;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Health;
using Jellyfin.Plugin.Lumen.Health.Checks;
using Jellyfin.Plugin.Lumen.Home;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Health;

public class TrailersChecksTests
{
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly IImdbTrailers _imdb = Substitute.For<IImdbTrailers>();

    public TrailersChecksTests() => _config.Current.Returns(new PluginConfiguration { YouTubeTrailers = true });

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task SettingOrPreviewsOff_IsNotApplicable_AndLinksToTheBannerCard(bool online, bool previews)
    {
        _config.Current.Returns(new PluginConfiguration { YouTubeTrailers = online, TrailerPreview = previews });

        var result = await Check().RunAsync(false, default);

        Assert.Equal(HealthStatus.NotApplicable, result.Status);
        Assert.Equal(HealthGroup.Trailers, result.Group);
        Assert.Equal(("setting", "hero"), (result.Fix!.Kind, result.Fix.Target));
        Assert.Empty(_imdb.ReceivedCalls());
    }

    [Fact]
    public async Task ATrailerFound_IsOk()
    {
        _imdb.CheckAsync(ImdbTrailersCheck.ProbeTitle, Arg.Any<CancellationToken>()).Returns(new ImdbCheck("https://imdb-video.media-imdb.com/a.mp4", null));

        Assert.Equal(HealthStatus.Ok, (await Check().RunAsync(false, default)).Status);
    }

    [Fact]
    public async Task NoTrailerForATitleThatHasOne_Warns()
    {
        _imdb.CheckAsync(default!, default).ReturnsForAnyArgs(new ImdbCheck(null, null));

        var result = await Check().RunAsync(false, default);

        Assert.Equal(HealthStatus.Warning, result.Status);
        Assert.Contains("YouTube", result.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, "IMDb refused Lumen's trailer lookups (HTTP 403).")]
    [InlineData(HttpStatusCode.TooManyRequests, "IMDb refused Lumen's trailer lookups (HTTP 429).")]
    public async Task Refused_IsAProblem_ThatAnUpdateFixes(HttpStatusCode status, string start)
    {
        _imdb.CheckAsync(default!, default).ReturnsForAnyArgs(new ImdbCheck(null, "IMDb answered with HTTP " + (int)status + ".", status));

        var result = await Check().RunAsync(false, default);

        Assert.Equal(HealthStatus.Problem, result.Status);
        Assert.StartsWith(start, result.Message, StringComparison.Ordinal);
        Assert.Equal("updates", result.Fix!.Target);
    }

    [Fact]
    public async Task Unreachable_IsAProblem_InPlainWords_WithoutTheAddress()
    {
        _imdb.CheckAsync(default!, default).ReturnsForAnyArgs(new ImdbCheck(null, "Couldn't reach IMDb: Connection refused (https://api.graphql.imdb.com/)."));

        var result = await Check().RunAsync(false, default);

        Assert.Equal(HealthStatus.Problem, result.Status);
        Assert.DoesNotContain("api.graphql", result.Message, StringComparison.Ordinal);
        Assert.Contains("reach the internet", result.Message, StringComparison.Ordinal);
    }

    private ImdbTrailersCheck Check() => new(_config, _imdb);
}
