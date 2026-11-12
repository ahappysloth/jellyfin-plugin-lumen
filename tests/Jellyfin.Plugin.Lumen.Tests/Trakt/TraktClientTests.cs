using System.Net;
using Jellyfin.Plugin.Lumen.Tests.Requests;
using Jellyfin.Plugin.Lumen.Trakt;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Trakt;

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

        var titles = await Client().GetTitlesAsync(Key, Weekly(TraktListKind.Movies, 30), CancellationToken.None);

        var request = Assert.Single(_http.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("https://api.trakt.tv/movies/watched/weekly?page=1&limit=30", request.RequestUri!.ToString());
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

        var titles = await Client().GetTitlesAsync(Key, Weekly(TraktListKind.Shows, 500), CancellationToken.None);

        Assert.Equal("https://api.trakt.tv/shows/watched/weekly?page=1&limit=100", _http.Requests[0].RequestUri!.ToString());
        Assert.Equal(new TraktTitle("Severance", 2022, 95396, "tt11280740", TraktListKind.Shows), Assert.Single(titles));
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

        var error = await Assert.ThrowsAsync<TraktException>(() => Client().GetTitlesAsync(Key, Weekly(TraktListKind.Movies, 10), CancellationToken.None));

        Assert.Contains(expected, error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(Key, error.Message, StringComparison.Ordinal);
        Assert.Equal(status, error.Status);
    }

    [Fact]
    public async Task AConnectionCutOffMidAnswer_IsATraktError()
    {
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new CutOffStream()) };

        var error = await Assert.ThrowsAsync<TraktException>(() => Client().GetTitlesAsync(Key, Weekly(TraktListKind.Movies, 10), CancellationToken.None));

        Assert.Contains("cut off", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task NotJson_Unreachable_AndTimeouts_AreTraktErrors()
    {
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html>") };
        await Assert.ThrowsAsync<TraktException>(() => Client().GetTitlesAsync(Key, Weekly(TraktListKind.Movies, 10), CancellationToken.None));

        _http.Respond = _ => throw new HttpRequestException("connection refused");
        Assert.Contains("Couldn't reach Trakt", (await Assert.ThrowsAsync<TraktException>(() => Client().GetTitlesAsync(Key, Weekly(TraktListKind.Movies, 10), CancellationToken.None))).Message, StringComparison.Ordinal);

        // What the client's own timeout looks like from inside HttpClient.
        _http.Respond = _ => throw new TaskCanceledException();
        Assert.Contains("did not answer", (await Assert.ThrowsAsync<TraktException>(() => Client().GetTitlesAsync(Key, Weekly(TraktListKind.Movies, 10), CancellationToken.None))).Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ACallerThatGivesUp_IsNotATraktError()
    {
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        _http.Respond = _ => throw new TaskCanceledException();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Client().GetTitlesAsync(Key, Weekly(TraktListKind.Movies, 10), cancelled.Token));
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

        Assert.Empty(await client.GetTitlesAsync(Key, Weekly(TraktListKind.Shows, 40), CancellationToken.None));

        Assert.Equal("http://localhost:5055/trakt/shows/watched/weekly?page=1&limit=40", _http.Requests[0].RequestUri!.ToString());
    }

    [Fact]
    public async Task ALongList_IsReadPageByPage_UpToItsLimit()
    {
        // Trakt pages 2 at a time here (its pages can be smaller than asked); the chart wants 5.
        _http.Respond = request =>
        {
            var page = int.Parse(System.Web.HttpUtility.ParseQueryString(request.RequestUri!.Query)["page"]!, System.Globalization.CultureInfo.InvariantCulture);
            var response = FakeHttp.Json($$"""[{ "movie": { "title": "P{{page}}a", "ids": { "tmdb": {{page * 10}} } } }, { "movie": { "title": "P{{page}}b", "ids": { "tmdb": {{(page * 10) + 1}} } } }]""");
            response.Headers.Add("X-Pagination-Page-Count", "9");
            return response;
        };

        var titles = await Client().GetTitlesAsync(Key, Weekly(TraktListKind.Movies, 5), CancellationToken.None);

        Assert.Equal(["P1a", "P1b", "P2a", "P2b", "P3a"], titles.Select(t => t.Title));
        Assert.Equal(
            ["page=1&limit=5", "page=2&limit=5", "page=3&limit=5"],
            _http.Requests.Select(r => r.RequestUri!.Query.TrimStart('?')));
    }

    [Fact]
    public async Task PagesStop_AtTheLastPage_AndAtAnEmptyOne()
    {
        _http.Respond = _ =>
        {
            var response = FakeHttp.Json("""[{ "movie": { "title": "Only" } }]""");
            response.Headers.Add("X-Pagination-Page-Count", "1");
            return response;
        };
        Assert.Single(await Client().GetTitlesAsync(Key, Weekly(TraktListKind.Movies, 100), CancellationToken.None));
        Assert.Single(_http.Requests);

        _http.Requests.Clear();
        _http.Respond = _ =>
        {
            var response = FakeHttp.Json("[]");
            response.Headers.Add("X-Pagination-Page-Count", "50");
            return response;
        };
        Assert.Empty(await Client().GetTitlesAsync(Key, Weekly(TraktListKind.Movies, 100), CancellationToken.None));
        Assert.Single(_http.Requests);
    }

    [Fact]
    public async Task NeverMoreThanFivePages()
    {
        _http.Respond = _ =>
        {
            var response = FakeHttp.Json("""[{ "movie": { "title": "One" } }]""");
            response.Headers.Add("X-Pagination-Page-Count", "1000");
            return response;
        };

        Assert.Equal(TraktClient.MaxPages, (await Client().GetTitlesAsync(Key, Weekly(TraktListKind.Movies, 100), CancellationToken.None)).Count);
        Assert.Equal(TraktClient.MaxPages, _http.Requests.Count);
    }

    [Theory]
    [InlineData("box", "https://api.trakt.tv/movies/boxoffice?page=1&limit=10")]
    [InlineData("anticipated", "https://api.trakt.tv/shows/anticipated?page=1&limit=40")]
    [InlineData("trending", "https://api.trakt.tv/movies/trending?page=1&limit=40")]
    [InlineData("monthly", "https://api.trakt.tv/movies/watched/monthly?page=1&limit=100")]
    [InlineData("all", "https://api.trakt.tv/shows/watched/all?page=1&limit=100")]
    public async Task EachListType_AsksForItsPath(string which, string expected)
    {
        _http.Respond = _ => FakeHttp.Json("[]");
        var query = which switch
        {
            "box" => TraktQuery.BoxOffice,
            "anticipated" => TraktQuery.Anticipated(TraktListKind.Shows),
            "trending" => TraktQuery.Trending(TraktListKind.Movies),
            "monthly" => TraktQuery.Watched(TraktListKind.Movies, TraktPeriod.Monthly),
            _ => TraktQuery.Watched(TraktListKind.Shows, TraktPeriod.All),
        };

        await Client().GetTitlesAsync(Key, query, CancellationToken.None);

        Assert.Equal(expected, _http.Requests[0].RequestUri!.ToString());
    }

    [Fact]
    public async Task TheBoxOffice_AndAnticipated_ReadTheirEntries()
    {
        _http.Respond = _ => FakeHttp.Json("""[{ "revenue": 48000000, "movie": { "title": "Big", "year": 2026, "ids": { "tmdb": 1 } } }]""");
        Assert.Equal(new TraktTitle("Big", 2026, 1, null), Assert.Single(await Client().GetTitlesAsync(Key, TraktQuery.BoxOffice, CancellationToken.None)));

        _http.Respond = _ => FakeHttp.Json("""[{ "list_count": 900, "show": { "title": "Soon", "year": 2027, "ids": { "tmdb": 2 } } }]""");
        Assert.Equal(
            new TraktTitle("Soon", 2027, 2, null, TraktListKind.Shows),
            Assert.Single(await Client().GetTitlesAsync(Key, TraktQuery.Anticipated(TraktListKind.Shows), CancellationToken.None)));
    }

    [Fact]
    public async Task AUsersList_MixesMoviesAndShows_InItsOrder()
    {
        Assert.True(TraktListRef.TryParse("https://trakt.tv/users/sean/lists/best-of", out var list));
        _http.Respond = _ => FakeHttp.Json("""
            [
              { "rank": 1, "type": "show", "show": { "title": "A show", "year": 2020, "ids": { "tmdb": 7 } } },
              { "rank": 2, "type": "movie", "movie": { "title": "A movie", "year": 2021, "ids": { "tmdb": 7, "imdb": "tt0000007" } } },
              { "rank": 3, "type": "person", "person": { "name": "Someone" } }
            ]
            """);

        var titles = await Client().GetTitlesAsync(Key, TraktQuery.ListItems(list), CancellationToken.None);

        Assert.Equal("https://api.trakt.tv/users/sean/lists/best-of/items/movie,show?page=1&limit=100", _http.Requests[0].RequestUri!.ToString());
        Assert.Equal([new TraktTitle("A show", 2020, 7, null, TraktListKind.Shows), new TraktTitle("A movie", 2021, 7, "tt0000007")], titles);
    }

    [Fact]
    public async Task AListsName_IsRead()
    {
        Assert.True(TraktListRef.TryParse("trakt.tv/lists/2142753", out var list));
        _http.Respond = _ => FakeHttp.Json("""{ "name": "  Oscar winners ", "privacy": "public", "ids": { "trakt": 2142753 } }""");

        Assert.Equal("Oscar winners", await Client().GetListNameAsync(Key, list, CancellationToken.None));
        Assert.Equal("https://api.trakt.tv/lists/2142753", _http.Requests[0].RequestUri!.ToString());
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task APrivateOrMissingList_SaysSo(HttpStatusCode status)
    {
        Assert.True(TraktListRef.TryParse("https://trakt.tv/users/sean/lists/secret", out var list));
        _http.Respond = _ => new HttpResponseMessage(status);

        var error = await Assert.ThrowsAsync<TraktException>(() => Client().GetListNameAsync(Key, list, CancellationToken.None));

        Assert.True(error.IsMissing);
        Assert.Contains("private or doesn't exist", error.Message, StringComparison.Ordinal);
    }

    public void Dispose() => _http.Dispose();

    private static TraktQuery Weekly(TraktListKind kind, int limit) => TraktQuery.Watched(kind, TraktPeriod.Weekly) with { Limit = limit };

    private TraktClient Client() => new(_http.Factory) { BaseUrl = TraktClient.DefaultBaseUrl };

    /// <summary>A body whose connection drops after the first bytes, as a reset mid-response does.</summary>
    private sealed class CutOffStream : MemoryStream
    {
        private bool _sent;

        public CutOffStream()
            : base("[{ \"movie\": "u8.ToArray())
        {
        }

        public override int Read(byte[] buffer, int offset, int count) => Next(() => base.Read(buffer, offset, count));

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(Next(() => Read(buffer.Span)));

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            Task.FromResult(Next(() => base.Read(buffer, offset, count)));

        private int Next(Func<int> read)
        {
            if (_sent)
            {
                throw new IOException("The connection was reset.");
            }

            _sent = true;
            return read();
        }
    }
}
