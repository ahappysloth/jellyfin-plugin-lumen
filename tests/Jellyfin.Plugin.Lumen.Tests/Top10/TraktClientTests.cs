using System.Net;
using Jellyfin.Plugin.Lumen.Tests.Requests;
using Jellyfin.Plugin.Lumen.Top10;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Top10;

public sealed class TraktClientTests : IDisposable
{
    private const string Key = "0123456789abcdef";

    private const string Movies = """
        [
          { "watcher_count": 900, "play_count": 1200, "movie": { "title": "Inception", "year": 2010, "ids": { "trakt": 16662, "slug": "inception-2010", "imdb": "tt1375666", "tmdb": 27205 } } },
          { "watcher_count": 800, "movie": { "title": "No TMDB", "year": 2024, "ids": { "trakt": 2, "imdb": "tt0000002", "tmdb": null } } },
          { "watcher_count": 700, "movie": { "title": "Odd ids", "year": 0, "ids": { "trakt": 3, "imdb": "nm123", "tmdb": 0 } } },
          { "watcher_count": 600 }
        ]
        """;

    private readonly FakeHttp _http = new();

    [Fact]
    public async Task WeeklyMovies_AsksTraktWithTheKey_AndReadsTheIds()
    {
        _http.Respond = _ => FakeHttp.Json(Movies);

        var titles = await Client().GetWeeklyWatchedAsync(Key, TraktListKind.Movies, 30, CancellationToken.None);

        var request = Assert.Single(_http.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("https://api.trakt.tv/movies/watched/weekly?limit=30", request.RequestUri!.ToString());
        Assert.Equal(["2"], request.Headers.GetValues("trakt-api-version"));
        Assert.Equal([Key], request.Headers.GetValues("trakt-api-key"));
        Assert.Equal(
            [
                new TraktTitle("Inception", 2010, 27205, "tt1375666"),
                new TraktTitle("No TMDB", 2024, null, "tt0000002"),
                new TraktTitle("Odd ids", null, null, null),
            ],
            titles);
    }

    [Fact]
    public async Task WeeklyShows_UseTheShowsList()
    {
        _http.Respond = _ => FakeHttp.Json("""[{ "watcher_count": 5, "show": { "title": "Severance", "year": 2022, "ids": { "tmdb": 95396, "imdb": "tt11280740", "tvdb": 371980 } } }]""");

        var titles = await Client().GetWeeklyWatchedAsync(Key, TraktListKind.Shows, 500, CancellationToken.None);

        Assert.Equal("https://api.trakt.tv/shows/watched/weekly?limit=100", _http.Requests[0].RequestUri!.ToString());
        Assert.Equal(new TraktTitle("Severance", 2022, 95396, "tt11280740"), Assert.Single(titles));
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "rejected the API key")]
    [InlineData(HttpStatusCode.Forbidden, "rejected the API key")]
    [InlineData(HttpStatusCode.TooManyRequests, "slow down")]
    [InlineData(HttpStatusCode.Found, "redirected")]
    [InlineData(HttpStatusCode.ServiceUnavailable, "HTTP 503")]
    public async Task ErrorStatuses_BecomeReadableErrors_WithoutTheKey(HttpStatusCode status, string expected)
    {
        _http.Respond = _ => new HttpResponseMessage(status);

        var error = await Assert.ThrowsAsync<TraktException>(() => Client().GetWeeklyWatchedAsync(Key, TraktListKind.Movies, 10, CancellationToken.None));

        Assert.Contains(expected, error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(Key, error.Message, StringComparison.Ordinal);
        Assert.Equal(status, error.Status);
    }

    [Fact]
    public async Task NotJson_Unreachable_AndTimeouts_AreTraktErrors()
    {
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html>") };
        await Assert.ThrowsAsync<TraktException>(() => Client().GetWeeklyWatchedAsync(Key, TraktListKind.Movies, 10, CancellationToken.None));

        _http.Respond = _ => throw new HttpRequestException("connection refused");
        Assert.Contains("Couldn't reach Trakt", (await Assert.ThrowsAsync<TraktException>(() => Client().GetWeeklyWatchedAsync(Key, TraktListKind.Movies, 10, CancellationToken.None))).Message, StringComparison.Ordinal);

        // What the client's own timeout looks like from inside HttpClient.
        _http.Respond = _ => throw new TaskCanceledException();
        Assert.Contains("did not answer", (await Assert.ThrowsAsync<TraktException>(() => Client().GetWeeklyWatchedAsync(Key, TraktListKind.Movies, 10, CancellationToken.None))).Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ACallerThatGivesUp_IsNotATraktError()
    {
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        _http.Respond = _ => throw new TaskCanceledException();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Client().GetWeeklyWatchedAsync(Key, TraktListKind.Movies, 10, cancelled.Token));
    }

    [Theory]
    [InlineData(null, "https://api.trakt.tv/")]
    [InlineData("", "https://api.trakt.tv/")]
    [InlineData("not a url", "https://api.trakt.tv/")]
    [InlineData("ftp://stub", "https://api.trakt.tv/")]
    [InlineData("http://host.docker.internal:5055/trakt", "http://host.docker.internal:5055/trakt/")]
    [InlineData("http://localhost:5055/trakt/", "http://localhost:5055/trakt/")]
    public void TheBaseUrl_CanBeOverridden_ForTests(string? value, string expected) =>
        Assert.Equal(expected, TraktClient.BaseUrlFrom(value).ToString());

    [Fact]
    public async Task AnOverriddenBaseUrl_KeepsItsPath()
    {
        _http.Respond = _ => FakeHttp.Json("[]");
        var client = new TraktClient(_http.Factory) { BaseUrl = TraktClient.BaseUrlFrom("http://localhost:5055/trakt") };

        Assert.Empty(await client.GetWeeklyWatchedAsync(Key, TraktListKind.Shows, 40, CancellationToken.None));

        Assert.Equal("http://localhost:5055/trakt/shows/watched/weekly?limit=40", _http.Requests[0].RequestUri!.ToString());
    }

    public void Dispose() => _http.Dispose();

    private TraktClient Client() => new(_http.Factory) { BaseUrl = TraktClient.DefaultBaseUrl };
}
