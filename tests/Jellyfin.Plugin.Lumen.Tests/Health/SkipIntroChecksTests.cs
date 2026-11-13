using Jellyfin.Plugin.Lumen.Health;
using Jellyfin.Plugin.Lumen.Health.Checks;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Health;

public class SkipIntroChecksTests
{
    private static readonly Guid IntroSkipperId = Guid.Parse("c83d86bb-a1e0-4c35-a113-e2101cf4ee6b");

    private static readonly Guid SkipMeId = Guid.Parse("b2a63e62-0ac5-4575-9ad2-2c7534ccb83d");

    private readonly IJellyfinFacts _jellyfin = Substitute.For<IJellyfinFacts>();

    public SkipIntroChecksTests()
    {
        _jellyfin.GetPlugins().Returns([]);
        _jellyfin.GetSegmentProviders().Returns([]);
        _jellyfin.GetLibraries().Returns([]);
    }

    [Fact]
    public async Task Plugins_NeitherInstalled_Warns_AndLinksToTheGuide()
    {
        _jellyfin.GetPlugins().Returns([Plugin("Lumen", "Active")]);

        var result = await Plugins().RunAsync(false, default);

        Assert.Equal(HealthStatus.Warning, result.Status);
        Assert.Equal(new HealthFix("Skip Intro setup guide", "help", "skipIntro"), result.Fix);
    }

    [Fact]
    public async Task Plugins_OneActive_IsOk_AndCallsTheOtherOptional()
    {
        _jellyfin.GetPlugins().Returns([Plugin("Intro Skipper", "Active")]);

        var result = await Plugins().RunAsync(false, default);

        Assert.Equal(HealthStatus.Ok, result.Status);
        Assert.Equal("Intro Skipper is installed. SkipMe.db is optional: it adds to what Intro Skipper finds.", result.Message);
    }

    [Fact]
    public async Task Plugins_BothActive_IsOk()
    {
        _jellyfin.GetPlugins().Returns([Plugin("Intro Skipper", "Active"), Plugin("SkipMe.db", "Active")]);

        Assert.Equal("Intro Skipper and SkipMe.db are installed.", (await Plugins().RunAsync(false, default)).Message);
    }

    [Fact]
    public async Task Plugins_InstalledButBroken_IsAProblem_WaitingForARestart_Warns()
    {
        _jellyfin.GetPlugins().Returns([Plugin("Intro Skipper", "Malfunctioned")]);
        var broken = await Plugins().RunAsync(false, default);
        Assert.Equal(HealthStatus.Problem, broken.Status);
        Assert.Contains("failed to load", broken.Message, StringComparison.Ordinal);
        Assert.Equal("plugins", broken.Fix!.Target);

        _jellyfin.GetPlugins().Returns([Plugin("SkipMe.db", "Restart")]);
        Assert.Equal(HealthStatus.Warning, (await Plugins().RunAsync(false, default)).Status);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Plugins_AnOldCopyBesideTheRunningOne_IsOk(bool oldFirst)
    {
        // An update leaves the old version listed (Superseded) beside the new one, in either order.
        InstalledPlugin[] copies = [Plugin("Intro Skipper", "Superseded", "12.0.5.0"), Plugin("Intro Skipper", "Active", "12.0.6.0")];
        _jellyfin.GetPlugins().Returns(oldFirst ? copies : copies.Reverse().ToArray());

        var result = await Plugins().RunAsync(false, default);

        Assert.Equal(HealthStatus.Ok, result.Status);
        Assert.StartsWith("Intro Skipper is installed.", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Plugins_TwoBrokenCopies_SaysHowTheNewestStands()
    {
        _jellyfin.GetPlugins().Returns([Plugin("Intro Skipper", "Malfunctioned", "12.0.5.0"), Plugin("Intro Skipper", "Superseded", "12.0.4.0")]);

        var result = await Plugins().RunAsync(false, default);

        Assert.Equal(HealthStatus.Problem, result.Status);
        Assert.Contains("failed to load", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Plugins_MatchedById_ThenByName()
    {
        // Its id under another name (a renamed build) counts; a lookalike name beside the real id doesn't.
        _jellyfin.GetPlugins().Returns([
            new InstalledPlugin(IntroSkipperId, "Intro Skipper (beta)", new Version(12, 0, 6, 0), "Active"),
            new InstalledPlugin(Guid.NewGuid(), "Intro Skipper", new Version(1, 0, 0, 0), "Malfunctioned"),
        ]);
        Assert.Equal(HealthStatus.Ok, (await Plugins().RunAsync(false, default)).Status);

        // No copy with the id: a fork under its own id is found by name.
        _jellyfin.GetPlugins().Returns([new InstalledPlugin(Guid.NewGuid(), "SkipMe.db fork", new Version(0, 2, 6, 0), "Active")]);
        Assert.Equal("SkipMe.db is installed. Intro Skipper is optional: it adds to what SkipMe.db finds.", (await Plugins().RunAsync(false, default)).Message);
    }

    [Fact]
    public async Task Plugins_OnlyBeingRemoved_CountsAsNotInstalled()
    {
        _jellyfin.GetPlugins().Returns([Plugin("Intro Skipper", "Deleted")]);

        Assert.StartsWith("Neither Intro Skipper nor SkipMe.db is installed.", (await Plugins().RunAsync(false, default)).Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Libraries_NoProvider_OrNoTvLibrary_IsNotApplicable()
    {
        Assert.Equal(HealthStatus.NotApplicable, (await Libraries().RunAsync(false, default)).Status);

        _jellyfin.GetSegmentProviders().Returns(["Intro Skipper"]);
        _jellyfin.GetLibraries().Returns([new LibrarySegmentOptions("Movies", "movies", ["Intro Skipper"])]);
        Assert.Equal("There's no TV library.", (await Libraries().RunAsync(false, default)).Message);
    }

    [Fact]
    public async Task Libraries_AllOn_IsOk()
    {
        _jellyfin.GetSegmentProviders().Returns(["Intro Skipper", "SkipMe.db"]);
        _jellyfin.GetLibraries().Returns([new LibrarySegmentOptions("Shows", "tvshows", []), new LibrarySegmentOptions("Anime", "tvshows", [])]);

        var result = await Libraries().RunAsync(false, default);

        Assert.Equal(HealthStatus.Ok, result.Status);
        Assert.Equal("Intro Skipper and SkipMe.db are on in all 2 TV libraries.", result.Message);
    }

    [Fact]
    public async Task Libraries_OneOffSomewhere_Warns_NamingTheLibraries()
    {
        _jellyfin.GetSegmentProviders().Returns(["Intro Skipper", "SkipMe.db"]);
        _jellyfin.GetLibraries().Returns(
        [
            new LibrarySegmentOptions("Shows", "tvshows", []),
            new LibrarySegmentOptions("Anime", "tvshows", ["skipme.db"]),
            new LibrarySegmentOptions("Kids", null, ["SkipMe.db"]),
            new LibrarySegmentOptions("Movies", "movies", ["Intro Skipper", "SkipMe.db"]),
        ]);

        var result = await Libraries().RunAsync(false, default);

        Assert.Equal(HealthStatus.Warning, result.Status);
        Assert.StartsWith("SkipMe.db is off in Anime and Kids.", result.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("Movies", result.Message, StringComparison.Ordinal);
        Assert.Equal("libraries", result.Fix!.Target);
    }

    [Fact]
    public async Task Libraries_EveryProviderOffInOne_IsAProblem()
    {
        _jellyfin.GetSegmentProviders().Returns(["Intro Skipper"]);
        _jellyfin.GetLibraries().Returns([new LibrarySegmentOptions("Shows", "tvshows", ["Intro Skipper"])]);

        var result = await Libraries().RunAsync(false, default);

        Assert.Equal(HealthStatus.Problem, result.Status);
        Assert.StartsWith("No segment provider runs in Shows, so its episodes get no Skip Intro.", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Coverage_CountsEpisodesWithIntros()
    {
        _jellyfin.GetIntroCoverageAsync(default).ReturnsForAnyArgs(new IntroCoverage(1204, 3310));

        var result = await Coverage().RunAsync(false, default);

        Assert.Equal(HealthStatus.Ok, result.Status);
        Assert.Equal("1,204 of 3,310 episodes have intro segments.", result.Message);
    }

    [Fact]
    public async Task Coverage_NoneYetWithAProvider_Warns_WithoutOne_IsNotApplicable()
    {
        _jellyfin.GetIntroCoverageAsync(default).ReturnsForAnyArgs(new IntroCoverage(0, 12));
        Assert.Equal(HealthStatus.NotApplicable, (await Coverage().RunAsync(false, default)).Status);

        _jellyfin.GetSegmentProviders().Returns(["Intro Skipper"]);
        var result = await Coverage().RunAsync(false, default);
        Assert.Equal(HealthStatus.Warning, result.Status);
        Assert.StartsWith("0 of 12 episodes have intro segments.", result.Message, StringComparison.Ordinal);
        Assert.Equal("tasks", result.Fix!.Target);
    }

    [Fact]
    public async Task Coverage_NoEpisodes_OrNoCount_IsNotApplicable()
    {
        _jellyfin.GetIntroCoverageAsync(default).ReturnsForAnyArgs(new IntroCoverage(0, 0));
        Assert.Equal("There are no episodes yet.", (await Coverage().RunAsync(false, default)).Message);

        _jellyfin.GetIntroCoverageAsync(default).ReturnsForAnyArgs((IntroCoverage?)null);
        Assert.Equal(HealthStatus.NotApplicable, (await Coverage().RunAsync(false, default)).Status);
    }

    /// <summary>A plugin as Jellyfin lists it: Intro Skipper and SkipMe.db under their real ids.</summary>
    private static InstalledPlugin Plugin(string name, string status, string version = "1.0.0.0") =>
        new(name switch { "Intro Skipper" => IntroSkipperId, "SkipMe.db" => SkipMeId, _ => Guid.NewGuid() }, name, Version.Parse(version), status);

    private SegmentPluginsCheck Plugins() => new(_jellyfin);

    private SegmentLibrariesCheck Libraries() => new(_jellyfin);

    private SegmentCoverageCheck Coverage() => new(_jellyfin);
}
