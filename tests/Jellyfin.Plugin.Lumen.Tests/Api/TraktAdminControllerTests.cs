using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Top10;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class TraktAdminControllerTests
{
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly ITraktClient _trakt = Substitute.For<ITraktClient>();

    [Fact]
    public async Task Test_UsesTheTypedKey_AndNamesThisWeeksTopMovie()
    {
        _config.Current.Returns(new PluginConfiguration { TraktClientId = "stored-key-0" });
        _trakt.GetWeeklyWatchedAsync("typed-key-00", TraktListKind.Movies, 1, Arg.Any<CancellationToken>()).Returns([new TraktTitle("Inception", 2010, 27205, null)]);

        var result = (await Controller().Test(new TraktTestRequestDto(" typed-key-00 "), CancellationToken.None)).Value!;

        Assert.Equal(new TraktTestResultDto(true, "Inception", null), result);
    }

    [Fact]
    public async Task Test_WithoutATypedKey_UsesTheStoredOne()
    {
        _config.Current.Returns(new PluginConfiguration { TraktClientId = "stored-key-0" });
        _trakt.GetWeeklyWatchedAsync(default!, default, default, default).ReturnsForAnyArgs([]);

        Assert.True((await Controller().Test(new TraktTestRequestDto(null), CancellationToken.None)).Value!.Ok);

        await _trakt.Received(1).GetWeeklyWatchedAsync("stored-key-0", TraktListKind.Movies, 1, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Test_WithNoKeyAtAll_AsksForOne_AndTraktErrorsAreShown()
    {
        _config.Current.Returns(new PluginConfiguration());
        Assert.Equal("Paste a Trakt Client ID first.", (await Controller().Test(new TraktTestRequestDto(string.Empty), CancellationToken.None)).Value!.Error);
        Assert.Empty(_trakt.ReceivedCalls());

        _trakt.GetWeeklyWatchedAsync(default!, default, default, default).ThrowsAsyncForAnyArgs(new TraktException("Trakt rejected the API key."));
        var failed = (await Controller().Test(new TraktTestRequestDto("bad-key-0000"), CancellationToken.None)).Value!;
        Assert.Equal(new TraktTestResultDto(false, null, "Trakt rejected the API key."), failed);
    }

    [Fact]
    public async Task Test_AKeyThatCantGoInAHeader_IsRefusedBeforeAsking()
    {
        _config.Current.Returns(new PluginConfiguration());

        var result = (await Controller().Test(new TraktTestRequestDto("0123abcd\r\n4567"), CancellationToken.None)).Value!;

        Assert.False(result.Ok);
        Assert.Contains("doesn't look like a Trakt Client ID", result.Error, StringComparison.Ordinal);
        Assert.Empty(_trakt.ReceivedCalls());
    }

    private TraktAdminController Controller() => new(_config, _trakt);
}
