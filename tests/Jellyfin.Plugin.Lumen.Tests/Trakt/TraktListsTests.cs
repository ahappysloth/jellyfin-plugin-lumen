using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Trakt;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Trakt;

public class TraktListsTests
{
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly ITraktClient _trakt = Substitute.For<ITraktClient>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly ListLogger<TraktLists> _logger = new();
    private readonly PluginConfiguration _settings = new() { TraktClientId = "key-one-0123" };
    private readonly TraktLists _lists;

    public TraktListsTests()
    {
        _config.Current.Returns(_ => _settings);
        _lists = new TraktLists(_config, _trakt, _time, _logger);
    }

    [Fact]
    public async Task WithoutAKey_IsNull_AndTraktIsNeverAsked()
    {
        _settings.TraktClientId = null;

        Assert.Null(await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None));
        Assert.Empty(_trakt.ReceivedCalls());
    }

    [Fact]
    public async Task EachList_IsFetchedOnce_AndCachedForHours()
    {
        _trakt.GetTitlesAsync("key-one-0123", Weekly(TraktListKind.Movies), Arg.Any<CancellationToken>()).Returns(List("A"));
        _trakt.GetTitlesAsync("key-one-0123", Weekly(TraktListKind.Shows), Arg.Any<CancellationToken>()).Returns(List("S"));

        Assert.Equal("A", (await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None))!.Titles[0].Title);
        Assert.Equal("S", (await _lists.GetAsync(Weekly(TraktListKind.Shows), CancellationToken.None))!.Titles[0].Title);
        _time.Advance(TraktQuery.ChartFreshFor - TimeSpan.FromMinutes(1));
        Assert.Equal("A", (await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None))!.Titles[0].Title);

        await _trakt.Received(1).GetTitlesAsync(Arg.Any<string>(), Weekly(TraktListKind.Movies), Arg.Any<CancellationToken>());
        await _trakt.Received(1).GetTitlesAsync(Arg.Any<string>(), Weekly(TraktListKind.Shows), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AStaleList_IsServedAtOnce_WhileOneRefreshRuns()
    {
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(List("Old"));
        await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None);
        var refresh = new TaskCompletionSource<IReadOnlyList<TraktTitle>>();
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(refresh.Task);
        _time.Advance(TraktQuery.ChartFreshFor);

        Assert.Equal("Old", (await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None))!.Titles[0].Title);
        Assert.Equal("Old", (await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None))!.Titles[0].Title);
        refresh.SetResult(List("New"));

        await WaitForAsync(async () => (await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None))!.Titles[0].Title == "New");
        await _trakt.Received(2).GetTitlesAsync(Arg.Any<string>(), Weekly(TraktListKind.Movies), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ConcurrentColdLoads_ShareOneFetch()
    {
        var fetch = new TaskCompletionSource<IReadOnlyList<TraktTitle>>();
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(fetch.Task);

        var loads = Enumerable.Range(0, 5).Select(_ => _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None)).ToList();
        fetch.SetResult(List("A"));

        Assert.All(await Task.WhenAll(loads), l => Assert.Equal("A", l!.Titles[0].Title));
        await _trakt.Received(1).GetTitlesAsync(Arg.Any<string>(), Arg.Any<TraktQuery>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task WhenTraktFails_TheLastGoodListIsServed_TraktRestsAWhile_AndItIsLoggedOnce()
    {
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(List("Good"));
        await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None);
        _trakt.GetTitlesAsync(default!, default!, default).ThrowsAsyncForAnyArgs(new TraktException("Trakt returned HTTP 503."));
        _time.Advance(TraktQuery.ChartFreshFor);

        // The stale list is served while the refresh fails in the background.
        Assert.Equal("Good", (await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None))!.Titles[0].Title);
        await WaitForAsync(() => Task.FromResult(_logger.Entries.Count > 0));
        for (var i = 0; i < 5; i++)
        {
            Assert.Equal("Good", (await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None))!.Titles[0].Title);
        }

        await _trakt.Received(2).GetTitlesAsync(Arg.Any<string>(), Arg.Any<TraktQuery>(), Arg.Any<CancellationToken>());

        // After the rest, Trakt is tried again; still failing, but not logged again.
        _time.Advance(TraktLists.RetryAfter);
        await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None);
        await WaitForAsync(() => Task.FromResult(_trakt.ReceivedCalls().Count() == 3));
        var warning = Assert.Single(_logger.Entries);
        Assert.Equal(LogLevel.Warning, warning.Level);
        Assert.Contains("Trakt returned HTTP 503.", warning.Message, StringComparison.Ordinal);
        Assert.Contains("the last copy it had", warning.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("key-one-0123", warning.Message, StringComparison.Ordinal);

        // A recovery is logged once too.
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(List("Back"));
        _time.Advance(TraktLists.RetryAfter);
        await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None);
        await WaitForAsync(async () => (await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None))!.Titles[0].Title == "Back");
        Assert.Equal(LogLevel.Information, _logger.Entries[^1].Level);
        Assert.Equal(2, _logger.Entries.Count);
    }

    [Fact]
    public async Task AColdFailure_IsNull_SoTheRowFallsBackOrHides()
    {
        _trakt.GetTitlesAsync(default!, default!, default).ThrowsAsyncForAnyArgs(new TraktException("Trakt rejected the API key."));

        Assert.Null(await _lists.GetAsync(Weekly(TraktListKind.Shows), CancellationToken.None));
        Assert.Null(await _lists.GetAsync(Weekly(TraktListKind.Shows), CancellationToken.None));

        await _trakt.Received(1).GetTitlesAsync(Arg.Any<string>(), Arg.Any<TraktQuery>(), Arg.Any<CancellationToken>());
        Assert.Contains("falls back for now", Assert.Single(_logger.Entries).Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ANewKey_StartsOver()
    {
        _trakt.GetTitlesAsync("key-one-0123", default!, default).ReturnsForAnyArgs(List("One"));
        await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None);
        _trakt.GetTitlesAsync("key-two-0123", Weekly(TraktListKind.Movies), Arg.Any<CancellationToken>()).Returns(List("Two"));

        _settings.TraktClientId = "key-two-0123";

        Assert.Equal("Two", (await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None))!.Titles[0].Title);
    }

    [Fact]
    public async Task ACallerThatGivesUp_DoesNotCancelTheFetch()
    {
        var fetch = new TaskCompletionSource<IReadOnlyList<TraktTitle>>();
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(fetch.Task);
        using var gaveUp = new CancellationTokenSource();

        var first = _lists.GetAsync(Weekly(TraktListKind.Movies), gaveUp.Token);
        await gaveUp.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        fetch.SetResult(List("A"));

        Assert.Equal("A", (await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None))!.Titles[0].Title);
        await _trakt.Received(1).GetTitlesAsync(Arg.Any<string>(), Arg.Any<TraktQuery>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task EachQuery_KeepsItsOwnFreshness()
    {
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(List("A"));
        var trending = TraktQuery.Trending(TraktListKind.Movies);
        var boxOffice = TraktQuery.BoxOffice;
        await _lists.GetAsync(trending, CancellationToken.None);
        await _lists.GetAsync(boxOffice, CancellationToken.None);

        _time.Advance(TraktQuery.TrendingFreshFor);
        await _lists.GetAsync(trending, CancellationToken.None);
        await _lists.GetAsync(boxOffice, CancellationToken.None);
        await WaitForAsync(() => Task.FromResult(_trakt.ReceivedCalls().Count() == 3));

        await _trakt.Received(2).GetTitlesAsync(Arg.Any<string>(), trending, Arg.Any<CancellationToken>());
        await _trakt.Received(1).GetTitlesAsync(Arg.Any<string>(), boxOffice, Arg.Any<CancellationToken>());
        Assert.True(TraktQuery.TrendingFreshFor < TraktQuery.ListFreshFor);
        Assert.True(TraktQuery.ListFreshFor < TraktQuery.ChartFreshFor);
        Assert.True(TraktQuery.ChartFreshFor < TraktQuery.AnticipatedFreshFor);
        Assert.True(TraktQuery.AnticipatedFreshFor < TraktQuery.BoxOfficeFreshFor);
    }

    [Fact]
    public async Task TheTop10Rows_AndThisWeeksChart_ShareOneCopy()
    {
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(List("A"));

        await _lists.GetAsync(TraktQuery.Watched(TraktListKind.Movies, TraktPeriod.Weekly), CancellationToken.None);
        await _lists.GetAsync(TraktQuery.Watched(TraktListKind.Movies, TraktPeriod.Weekly), CancellationToken.None);
        await _lists.GetAsync(TraktQuery.Watched(TraktListKind.Movies, TraktPeriod.Monthly), CancellationToken.None);

        Assert.Equal(2, _trakt.ReceivedCalls().Count());
    }

    [Fact]
    public async Task AUsersList_HasItsName()
    {
        var query = ListQuery("https://trakt.tv/users/sean/lists/best-of");
        _trakt.GetListNameAsync("key-one-0123", query.List!, Arg.Any<CancellationToken>()).Returns("Best of");
        _trakt.GetTitlesAsync("key-one-0123", query, Arg.Any<CancellationToken>()).Returns(List("A"));

        var list = await _lists.GetAsync(query, CancellationToken.None);

        Assert.Equal(("Best of", "A"), (list!.Name, list.Titles[0].Title));
    }

    [Fact]
    public async Task AListMadePrivate_IsDropped_NotServedStale_AndLoggedOnce()
    {
        var query = ListQuery("https://trakt.tv/users/sean/lists/best-of");
        _trakt.GetListNameAsync(default!, default!, default).ReturnsForAnyArgs("Best of");
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(List("A"));
        Assert.NotNull(await _lists.GetAsync(query, CancellationToken.None));

        _trakt.GetListNameAsync(default!, default!, default)
            .ThrowsAsyncForAnyArgs(new TraktException("The list is private or doesn't exist (HTTP 404).") { Status = System.Net.HttpStatusCode.NotFound });
        _time.Advance(TraktQuery.ListFreshFor);
        await _lists.GetAsync(query, CancellationToken.None);
        await WaitForAsync(async () => await _lists.GetAsync(query, CancellationToken.None) is null);

        _time.Advance(TraktLists.RetryAfter);
        Assert.Null(await _lists.GetAsync(query, CancellationToken.None));
        await WaitForAsync(() => Task.FromResult(_trakt.ReceivedCalls().Count(c => c.GetMethodInfo().Name == "GetListNameAsync") == 3));
        var warning = Assert.Single(_logger.Entries);
        Assert.Contains("list sean/best-of", warning.Message, StringComparison.Ordinal);
        Assert.Contains("its row is hidden", warning.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AListThatNeverLoaded_IsNull_EvenIfItsItemsAnswer()
    {
        var query = ListQuery("trakt.tv/users/sean/lists/gone");
        _trakt.GetListNameAsync(default!, default!, default)
            .ThrowsAsyncForAnyArgs(new TraktException("gone") { Status = System.Net.HttpStatusCode.NotFound });
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(List("A"));

        Assert.Null(await _lists.GetAsync(query, CancellationToken.None));
        Assert.Contains("its row is hidden", Assert.Single(_logger.Entries).Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AListsNameAndItems_AreAskedForAtOnce()
    {
        var query = ListQuery("https://trakt.tv/users/sean/lists/best-of");
        var name = new TaskCompletionSource<string?>();
        var items = new TaskCompletionSource<IReadOnlyList<TraktTitle>>();
        _trakt.GetListNameAsync(default!, default!, default).ReturnsForAnyArgs(name.Task);
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(items.Task);

        var load = _lists.GetAsync(query, CancellationToken.None);

        // The items are asked for while the name is still on its way.
        await WaitForAsync(() => Task.FromResult(_trakt.ReceivedCalls().Count() == 2));
        items.SetResult(List("A"));
        name.SetResult("Best of");
        Assert.Equal(("Best of", "A"), ((await load)!.Name, (await load)!.Titles[0].Title));
    }

    [Fact]
    public async Task AListWhoseItemsFailFirst_StillSaysItIsGone_WhenItsNameDoes()
    {
        var query = ListQuery("https://trakt.tv/users/sean/lists/best-of");
        var name = new TaskCompletionSource<string?>();
        _trakt.GetListNameAsync(default!, default!, default).ReturnsForAnyArgs(name.Task);
        _trakt.GetTitlesAsync(default!, default!, default)
            .ThrowsAsyncForAnyArgs(new TraktException("Trakt did not answer within 3 seconds."));

        var load = _lists.GetAsync(query, CancellationToken.None);
        name.SetException(new TraktException("The list is private or doesn't exist (HTTP 404).") { Status = System.Net.HttpStatusCode.NotFound });

        Assert.Null(await load);
        Assert.Contains("its row is hidden", Assert.Single(_logger.Entries).Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AUsersListRefusedForTheKey_KeepsItsLastCopy()
    {
        var query = ListQuery("https://trakt.tv/users/sean/lists/best-of");
        _trakt.GetListNameAsync(default!, default!, default).ReturnsForAnyArgs("Best of");
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(List("A"));
        await _lists.GetAsync(query, CancellationToken.None);
        var refused = new TraktException("Trakt rejected the API key.") { Status = System.Net.HttpStatusCode.Forbidden };
        _trakt.GetListNameAsync(default!, default!, default).ThrowsAsyncForAnyArgs(refused);
        _trakt.GetTitlesAsync(default!, default!, default).ThrowsAsyncForAnyArgs(refused);
        _time.Advance(TraktQuery.ListFreshFor);

        await _lists.GetAsync(query, CancellationToken.None);
        await WaitForAsync(() => Task.FromResult(_logger.Entries.Count == 1));

        Assert.Equal("Best of", (await _lists.GetAsync(query, CancellationToken.None))!.Name);
        Assert.Contains("it shows the last copy it had", _logger.Entries[0].Message, StringComparison.Ordinal);
        Assert.Contains("rejected the API key", _logger.Entries[0].Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AListNobodyAsksForInADay_IsForgotten()
    {
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(List("A"));
        await _lists.GetAsync(Weekly(TraktListKind.Movies), CancellationToken.None);
        await _lists.GetAsync(Weekly(TraktListKind.Shows), CancellationToken.None);
        Assert.Equal(2, _lists.CachedCount);

        // Shows are still on someone's home after 20 hours; movies aren't.
        _time.Advance(TimeSpan.FromHours(20));
        await _lists.GetAsync(Weekly(TraktListKind.Shows), CancellationToken.None);
        await WaitForAsync(async () => (await _lists.GetAsync(Weekly(TraktListKind.Shows), CancellationToken.None))!.Titles.Count == 1 && _trakt.ReceivedCalls().Count() == 3);
        _time.Advance(TimeSpan.FromHours(5));
        await _lists.GetAsync(Weekly(TraktListKind.Shows), CancellationToken.None);

        Assert.Equal(1, _lists.CachedCount);
    }

    [Fact]
    public async Task AListThatFailsOtherwise_KeepsItsLastCopy()
    {
        var query = ListQuery("https://trakt.tv/users/sean/lists/best-of");
        _trakt.GetListNameAsync(default!, default!, default).ReturnsForAnyArgs("Best of");
        _trakt.GetTitlesAsync(default!, default!, default).ReturnsForAnyArgs(List("A"));
        await _lists.GetAsync(query, CancellationToken.None);
        _trakt.GetListNameAsync(default!, default!, default).ThrowsAsyncForAnyArgs(new TraktException("Trakt returned HTTP 502.") { Status = System.Net.HttpStatusCode.BadGateway });
        _time.Advance(TraktQuery.ListFreshFor);

        await _lists.GetAsync(query, CancellationToken.None);
        await WaitForAsync(() => Task.FromResult(_logger.Entries.Count == 1));

        Assert.Equal("Best of", (await _lists.GetAsync(query, CancellationToken.None))!.Name);
    }

    [Fact]
    public void Enabled_FollowsTheKey()
    {
        Assert.True(_lists.Enabled);
        _settings.TraktClientId = " ";
        Assert.False(_lists.Enabled);
    }

    private static TraktQuery Weekly(TraktListKind kind) => TraktQuery.Watched(kind, TraktPeriod.Weekly);

    private static TraktQuery ListQuery(string url) =>
        TraktListRef.TryParse(url, out var list) ? TraktQuery.ListItems(list) : throw new ArgumentException(url);

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
