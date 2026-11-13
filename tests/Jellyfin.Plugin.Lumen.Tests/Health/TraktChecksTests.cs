using System.Net;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Health;
using Jellyfin.Plugin.Lumen.Health.Checks;
using Jellyfin.Plugin.Lumen.Trakt;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Health;

public class TraktChecksTests
{
    private const string Key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly ITraktClient _trakt = Substitute.For<ITraktClient>();
    private readonly ITraktLists _lists = Substitute.For<ITraktLists>();
    private readonly FakeTimeProvider _time = new(DateTimeOffset.Parse("2026-11-12T12:00:00Z", System.Globalization.CultureInfo.InvariantCulture));

    public TraktChecksTests()
    {
        _config.Current.Returns(new PluginConfiguration { TraktClientId = Key });
        _lists.Enabled.Returns(true);
    }

    [Fact]
    public async Task Key_None_IsNotApplicable_AndLinksToTheTraktCard()
    {
        _config.Current.Returns(new PluginConfiguration());

        var result = await KeyCheck().RunAsync(false, default);

        Assert.Equal(HealthStatus.NotApplicable, result.Status);
        Assert.Equal("trakt", result.Fix!.Target);
        Assert.Empty(_trakt.ReceivedCalls());
    }

    [Fact]
    public async Task Key_Works_IsOk()
    {
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs([]);

        Assert.Equal(HealthStatus.Ok, (await KeyCheck().RunAsync(false, default)).Status);
        await _trakt.Received(1).GetTitlesAsync(Key, Arg.Is<TraktQuery>(q => q.Limit == 1), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Key_Refused_IsAProblem()
    {
        _trakt.GetTitlesAsync(default!, default!, default).ThrowsAsyncForAnyArgs(new TraktException("Trakt rejected the API key.") { Status = HttpStatusCode.Forbidden });

        var result = await KeyCheck().RunAsync(false, default);

        Assert.Equal(HealthStatus.Problem, result.Status);
        Assert.DoesNotContain(Key, result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Key_TraktDown_Warns()
    {
        _trakt.GetTitlesAsync(default!, default!, default).ThrowsAsyncForAnyArgs(new TraktException("Trakt did not answer within 3 seconds."));

        Assert.Equal(HealthStatus.Warning, (await KeyCheck().RunAsync(false, default)).Status);
    }

    [Fact]
    public async Task Lists_NoKey_OrNothingFetchedYet_IsNotApplicable()
    {
        _lists.LastFetch.Returns((TraktFetch?)null);
        Assert.Contains("since Jellyfin started", (await ListsCheck().RunAsync(false, default)).Message, StringComparison.Ordinal);

        _lists.Enabled.Returns(false);
        Assert.Equal(HealthStatus.NotApplicable, (await ListsCheck().RunAsync(false, default)).Status);
    }

    [Fact]
    public async Task Lists_LastFetchWorked_IsOk_AndSaysWhen()
    {
        _lists.LastFetch.Returns(new TraktFetch(_time.GetUtcNow().AddMinutes(-12), null, true));

        var result = await ListsCheck().RunAsync(false, default);

        Assert.Equal(HealthStatus.Ok, result.Status);
        Assert.Equal("The last Trakt list loaded 12 minutes ago.", result.Message);
    }

    [Fact]
    public async Task Lists_FailedWithAnOlderCopy_Warns_WithoutOne_IsAProblem()
    {
        _lists.LastFetch.Returns(new TraktFetch(_time.GetUtcNow().AddHours(-2), "Trakt did not answer within 3 seconds.", true));
        var stale = await ListsCheck().RunAsync(false, default);
        Assert.Equal(HealthStatus.Warning, stale.Status);
        Assert.StartsWith("The last Trakt list fetch failed 2 hours ago: Trakt did not answer", stale.Message, StringComparison.Ordinal);

        _lists.LastFetch.Returns(new TraktFetch(_time.GetUtcNow().AddHours(-2), "Trakt rejected the API key.", false));
        Assert.Equal(HealthStatus.Problem, (await ListsCheck().RunAsync(false, default)).Status);
    }

    private TraktKeyCheck KeyCheck() => new(_config, _trakt);

    private TraktListsCheck ListsCheck() => new(_lists, _time);
}
