using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Top10;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Top10;

public class Top10ListsTests
{
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly ITraktClient _trakt = Substitute.For<ITraktClient>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly ListLogger<Top10Lists> _logger = new();
    private readonly PluginConfiguration _settings = new() { TraktClientId = "key-one-0123" };
    private readonly Top10Lists _lists;

    public Top10ListsTests()
    {
        _config.Current.Returns(_ => _settings);
        _lists = new Top10Lists(_config, _trakt, _time, _logger);
    }

    [Fact]
    public async Task WithoutAKey_IsNull_AndTraktIsNeverAsked()
    {
        _settings.TraktClientId = null;

        Assert.Null(await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None));
        Assert.Empty(_trakt.ReceivedCalls());
    }

    [Fact]
    public async Task EachList_IsFetchedOnce_AndCachedForHours()
    {
        _trakt.GetWeeklyWatchedAsync("key-one-0123", TraktListKind.Movies, Top10Lists.FetchLimit, Arg.Any<CancellationToken>()).Returns(List("A"));
        _trakt.GetWeeklyWatchedAsync("key-one-0123", TraktListKind.Shows, Top10Lists.FetchLimit, Arg.Any<CancellationToken>()).Returns(List("S"));

        Assert.Equal("A", (await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None))![0].Title);
        Assert.Equal("S", (await _lists.GetAsync(TraktListKind.Shows, CancellationToken.None))![0].Title);
        _time.Advance(Top10Lists.FreshFor - TimeSpan.FromMinutes(1));
        Assert.Equal("A", (await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None))![0].Title);

        await _trakt.Received(1).GetWeeklyWatchedAsync(Arg.Any<string>(), TraktListKind.Movies, Arg.Any<int>(), Arg.Any<CancellationToken>());
        await _trakt.Received(1).GetWeeklyWatchedAsync(Arg.Any<string>(), TraktListKind.Shows, Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AStaleList_IsServedAtOnce_WhileOneRefreshRuns()
    {
        _trakt.GetWeeklyWatchedAsync(default!, default, default, default).ReturnsForAnyArgs(List("Old"));
        await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None);
        var refresh = new TaskCompletionSource<IReadOnlyList<TraktTitle>>();
        _trakt.GetWeeklyWatchedAsync(default!, default, default, default).ReturnsForAnyArgs(refresh.Task);
        _time.Advance(Top10Lists.FreshFor);

        Assert.Equal("Old", (await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None))![0].Title);
        Assert.Equal("Old", (await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None))![0].Title);
        refresh.SetResult(List("New"));

        await WaitForAsync(async () => (await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None))![0].Title == "New");
        await _trakt.Received(2).GetWeeklyWatchedAsync(Arg.Any<string>(), TraktListKind.Movies, Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ConcurrentColdLoads_ShareOneFetch()
    {
        var fetch = new TaskCompletionSource<IReadOnlyList<TraktTitle>>();
        _trakt.GetWeeklyWatchedAsync(default!, default, default, default).ReturnsForAnyArgs(fetch.Task);

        var loads = Enumerable.Range(0, 5).Select(_ => _lists.GetAsync(TraktListKind.Movies, CancellationToken.None)).ToList();
        fetch.SetResult(List("A"));

        Assert.All(await Task.WhenAll(loads), l => Assert.Equal("A", l![0].Title));
        await _trakt.Received(1).GetWeeklyWatchedAsync(Arg.Any<string>(), Arg.Any<TraktListKind>(), Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task WhenTraktFails_TheLastGoodListIsServed_TraktRestsAWhile_AndItIsLoggedOnce()
    {
        _trakt.GetWeeklyWatchedAsync(default!, default, default, default).ReturnsForAnyArgs(List("Good"));
        await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None);
        _trakt.GetWeeklyWatchedAsync(default!, default, default, default).ThrowsAsyncForAnyArgs(new TraktException("Trakt returned HTTP 503."));
        _time.Advance(Top10Lists.FreshFor);

        // The stale list is served while the refresh fails in the background.
        Assert.Equal("Good", (await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None))![0].Title);
        await WaitForAsync(() => Task.FromResult(_logger.Entries.Count > 0));
        for (var i = 0; i < 5; i++)
        {
            Assert.Equal("Good", (await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None))![0].Title);
        }

        await _trakt.Received(2).GetWeeklyWatchedAsync(Arg.Any<string>(), Arg.Any<TraktListKind>(), Arg.Any<int>(), Arg.Any<CancellationToken>());

        // After the rest, Trakt is tried again; still failing, but not logged again.
        _time.Advance(Top10Lists.RetryAfter);
        await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None);
        await WaitForAsync(() => Task.FromResult(_trakt.ReceivedCalls().Count() == 3));
        var warning = Assert.Single(_logger.Entries);
        Assert.Equal(LogLevel.Warning, warning.Level);
        Assert.Contains("Trakt returned HTTP 503.", warning.Message, StringComparison.Ordinal);
        Assert.Contains("the last list it had", warning.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("key-one-0123", warning.Message, StringComparison.Ordinal);

        // A recovery is logged once too.
        _trakt.GetWeeklyWatchedAsync(default!, default, default, default).ReturnsForAnyArgs(List("Back"));
        _time.Advance(Top10Lists.RetryAfter);
        await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None);
        await WaitForAsync(async () => (await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None))![0].Title == "Back");
        Assert.Equal(LogLevel.Information, _logger.Entries[^1].Level);
        Assert.Equal(2, _logger.Entries.Count);
    }

    [Fact]
    public async Task AColdFailure_IsNull_SoTheRowFallsBackToSeerr()
    {
        _trakt.GetWeeklyWatchedAsync(default!, default, default, default).ThrowsAsyncForAnyArgs(new TraktException("Trakt rejected the API key."));

        Assert.Null(await _lists.GetAsync(TraktListKind.Shows, CancellationToken.None));
        Assert.Null(await _lists.GetAsync(TraktListKind.Shows, CancellationToken.None));

        await _trakt.Received(1).GetWeeklyWatchedAsync(Arg.Any<string>(), Arg.Any<TraktListKind>(), Arg.Any<int>(), Arg.Any<CancellationToken>());
        Assert.Contains("Seerr's trending titles", Assert.Single(_logger.Entries).Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ANewKey_StartsOver()
    {
        _trakt.GetWeeklyWatchedAsync("key-one-0123", default, default, default).ReturnsForAnyArgs(List("One"));
        await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None);
        _trakt.GetWeeklyWatchedAsync("key-two-0123", TraktListKind.Movies, Arg.Any<int>(), Arg.Any<CancellationToken>()).Returns(List("Two"));

        _settings.TraktClientId = "key-two-0123";

        Assert.Equal("Two", (await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None))![0].Title);
    }

    [Fact]
    public async Task ACallerThatGivesUp_DoesNotCancelTheFetch()
    {
        var fetch = new TaskCompletionSource<IReadOnlyList<TraktTitle>>();
        _trakt.GetWeeklyWatchedAsync(default!, default, default, default).ReturnsForAnyArgs(fetch.Task);
        using var gaveUp = new CancellationTokenSource();

        var first = _lists.GetAsync(TraktListKind.Movies, gaveUp.Token);
        await gaveUp.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        fetch.SetResult(List("A"));

        Assert.Equal("A", (await _lists.GetAsync(TraktListKind.Movies, CancellationToken.None))![0].Title);
        await _trakt.Received(1).GetWeeklyWatchedAsync(Arg.Any<string>(), Arg.Any<TraktListKind>(), Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    private static IReadOnlyList<TraktTitle> List(string first) => [new TraktTitle(first, 2026, 1, null)];

    private static async Task WaitForAsync(Func<Task<bool>> condition)
    {
        for (var i = 0; i < 200; i++)
        {
            if (await condition())
            {
                return;
            }

            await Task.Delay(10);
        }

        Assert.Fail("Timed out waiting for the condition.");
    }
}
