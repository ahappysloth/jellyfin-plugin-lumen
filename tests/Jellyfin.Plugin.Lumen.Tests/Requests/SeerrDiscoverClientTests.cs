using System.Net;
using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public sealed class SeerrDiscoverClientTests : IDisposable
{
    private const string EmptyPage = """{"page":1,"totalPages":1,"results":[]}""";
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/base/"), "key123");
    private readonly FakeHttp _http = new();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly SeerrClient _client;

    public SeerrDiscoverClientTests()
    {
        _client = new SeerrClient(_http.Factory, _time, NullLogger<SeerrClient>.Instance);
    }

    public void Dispose() => _http.Dispose();

    [Theory]
    [InlineData(SeerrDiscoverList.Trending, "/base/api/v1/discover/trending?page=1")]
    [InlineData(SeerrDiscoverList.PopularMovies, "/base/api/v1/discover/movies?page=1")]
    [InlineData(SeerrDiscoverList.PopularTv, "/base/api/v1/discover/tv?page=1")]
    [InlineData(SeerrDiscoverList.UpcomingMovies, "/base/api/v1/discover/movies/upcoming?page=1")]
    [InlineData(SeerrDiscoverList.UpcomingTv, "/base/api/v1/discover/tv/upcoming?page=1")]
    public async Task Discover_UsesItsPath_AsTheUser(SeerrDiscoverList list, string path)
    {
        _http.Respond = _ => FakeHttp.Json("""{"page":1,"totalPages":5,"results":[{"mediaType":"movie","id":603,"title":"The Matrix"},{"mediaType":"person","id":1,"name":"P"}]}""");

        var page = await _client.DiscoverAsync(Endpoint, 7, list, CancellationToken.None);

        var request = Assert.Single(_http.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal(path, request.RequestUri!.PathAndQuery);
        Assert.Equal("key123", Assert.Single(request.Headers.GetValues("X-Api-Key")));
        Assert.Equal("7", Assert.Single(request.Headers.GetValues("X-Api-User")));
        Assert.Equal(2, page.Results!.Count);
    }

    [Fact]
    public async Task UserRequests_UsesItsPath_AndParsesTheResults()
    {
        _http.Respond = _ => FakeHttp.Json(
            """
            {"pageInfo":{"pages":1,"pageSize":20,"results":2,"page":1},"results":[
              {"id":12,"status":2,"createdAt":"2026-11-07T10:00:00.000Z","type":"tv",
               "media":{"id":3,"tmdbId":1399,"mediaType":"tv","status":4,"jellyfinMediaId":"0123456789abcdef0123456789abcdef"}},
              {"id":11,"status":3,"createdAt":"2026-11-06T10:00:00.000Z","type":"movie","media":{"tmdbId":603,"mediaType":"movie","status":2}}
            ]}
            """);

        var requests = await _client.GetUserRequestsAsync(Endpoint, 7, CancellationToken.None);

        var request = Assert.Single(_http.Requests);
        Assert.Equal("/base/api/v1/user/7/requests?take=20&skip=0&sort=added", request.RequestUri!.PathAndQuery);
        Assert.Equal("7", Assert.Single(request.Headers.GetValues("X-Api-User")));
        Assert.Equal(2, requests.Count);
        var first = requests[0];
        Assert.Equal((12, 2, "tv"), (first.Id, first.Status, first.Type));
        Assert.Equal(new DateTimeOffset(2026, 11, 7, 10, 0, 0, TimeSpan.Zero), first.CreatedAt);
        Assert.Equal((1399, "tv", 4, "0123456789abcdef0123456789abcdef"), (first.Media!.TmdbId, first.Media.MediaType, first.Media.Status, first.Media.JellyfinMediaId));
        Assert.Equal((3, 603), (requests[1].Status, requests[1].Media!.TmdbId));
    }

    [Fact]
    public async Task UserRequests_AreNotCached()
    {
        _http.Respond = _ => FakeHttp.Json("""{"results":[]}""");

        await _client.GetUserRequestsAsync(Endpoint, 7, CancellationToken.None);
        await _client.GetUserRequestsAsync(Endpoint, 7, CancellationToken.None);

        Assert.Equal(2, _http.Requests.Count);
    }

    [Fact]
    public async Task Discover_IsCachedServerWide_ForTenMinutes()
    {
        _http.Respond = _ => FakeHttp.Json(EmptyPage);

        var first = await _client.DiscoverAsync(Endpoint, 7, SeerrDiscoverList.Trending, CancellationToken.None);
        _time.Advance(TimeSpan.FromMinutes(9));
        var second = await _client.DiscoverAsync(Endpoint, 8, SeerrDiscoverList.Trending, CancellationToken.None);

        Assert.Same(first, second);
        Assert.Single(_http.Requests);

        _time.Advance(TimeSpan.FromMinutes(2));
        await _client.DiscoverAsync(Endpoint, 7, SeerrDiscoverList.Trending, CancellationToken.None);
        Assert.Equal(2, _http.Requests.Count);
    }

    [Fact]
    public async Task Cache_IsKeyedByListAndEndpoint()
    {
        _http.Respond = _ => FakeHttp.Json(EmptyPage);
        var otherKey = Endpoint with { ApiKey = "other" };
        var otherUrl = Endpoint with { BaseUrl = new Uri("http://seerr2:5055/") };

        await _client.DiscoverAsync(Endpoint, 7, SeerrDiscoverList.Trending, CancellationToken.None);
        await _client.DiscoverAsync(Endpoint, 7, SeerrDiscoverList.PopularMovies, CancellationToken.None);
        await _client.DiscoverAsync(otherKey, 7, SeerrDiscoverList.Trending, CancellationToken.None);
        await _client.DiscoverAsync(otherUrl, 7, SeerrDiscoverList.Trending, CancellationToken.None);

        Assert.Equal(4, _http.Requests.Count);
    }

    [Fact]
    public async Task Errors_AreNotCached()
    {
        var calls = 0;
        _http.Respond = _ => ++calls == 1 ? new HttpResponseMessage(HttpStatusCode.InternalServerError) : FakeHttp.Json(EmptyPage);

        await Assert.ThrowsAsync<SeerrException>(() => _client.DiscoverAsync(Endpoint, 7, SeerrDiscoverList.Trending, CancellationToken.None));
        await _client.DiscoverAsync(Endpoint, 7, SeerrDiscoverList.Trending, CancellationToken.None);

        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task TitleSummary_IsCachedPerTitle_ButTitleDetailsAndSearchAreNot()
    {
        _http.Respond = r => r.RequestUri!.AbsolutePath.Contains("/search", StringComparison.Ordinal)
            ? FakeHttp.Json(EmptyPage)
            : FakeHttp.Json("""{"id":603,"title":"The Matrix"}""");

        await _client.GetTitleSummaryAsync(Endpoint, 7, "movie", 603, CancellationToken.None);
        await _client.GetTitleSummaryAsync(Endpoint, 8, "movie", 603, CancellationToken.None);
        await _client.GetTitleSummaryAsync(Endpoint, 7, "tv", 603, CancellationToken.None);
        await _client.GetMovieAsync(Endpoint, 7, 603, CancellationToken.None);
        await _client.GetMovieAsync(Endpoint, 7, 603, CancellationToken.None);
        await _client.SearchAsync(Endpoint, 7, "x", 1, CancellationToken.None);
        await _client.SearchAsync(Endpoint, 7, "x", 1, CancellationToken.None);

        Assert.Equal(
            ["/base/api/v1/movie/603", "/base/api/v1/tv/603", "/base/api/v1/movie/603", "/base/api/v1/movie/603", "/base/api/v1/search", "/base/api/v1/search"],
            _http.Requests.Select(r => r.RequestUri!.AbsolutePath));
    }

    [Fact]
    public void ResponseCache_IsBounded_EvictingTheOldestFirst()
    {
        var cache = new SeerrResponseCache(_time);
        for (var i = 0; i < SeerrResponseCache.Capacity + 5; i++)
        {
            cache.Set("k" + i, "v" + i);
        }

        Assert.Equal(SeerrResponseCache.Capacity, cache.Count);
        Assert.False(cache.TryGet<string>("k4", out _));
        Assert.True(cache.TryGet<string>("k5", out var kept));
        Assert.Equal("v5", kept);
        Assert.True(cache.TryGet<string>("k" + (SeerrResponseCache.Capacity + 4), out _));
    }

    [Fact]
    public void ResponseCache_DropsExpiredEntriesBeforeEvictingLiveOnes()
    {
        var cache = new SeerrResponseCache(_time);
        for (var i = 0; i < SeerrResponseCache.Capacity - 1; i++)
        {
            cache.Set("old" + i, "v");
        }

        _time.Advance(SeerrResponseCache.Ttl + TimeSpan.FromSeconds(1));
        cache.Set("live1", "v");
        cache.Set("live2", "v");

        Assert.Equal(2, cache.Count);
        Assert.True(cache.TryGet<string>("live1", out _));
    }

    [Fact]
    public async Task Breaker_OpensAfterThreeFailures_AndFailsFastWithoutTheNetwork()
    {
        _http.Respond = _ => throw new HttpRequestException("connection refused");

        for (var i = 0; i < SeerrCircuitBreaker.Threshold; i++)
        {
            var failure = await Assert.ThrowsAsync<SeerrException>(() => _client.SearchAsync(Endpoint, 7, "x", 1, CancellationToken.None));
            Assert.False(failure.IsCircuitOpen);
        }

        var fast = await Assert.ThrowsAsync<SeerrException>(() => _client.GetMovieAsync(Endpoint, 7, 603, CancellationToken.None));
        Assert.True(fast.IsCircuitOpen);
        Assert.Equal("Seerr is temporarily unavailable.", fast.Message);
        await Assert.ThrowsAsync<SeerrException>(() => _client.GetUserByJellyfinIdAsync(Endpoint, Guid.NewGuid(), CancellationToken.None));
        await Assert.ThrowsAsync<SeerrException>(() => _client.CreateRequestAsync(Endpoint, 7, "movie", 603, null, CancellationToken.None));
        Assert.Equal(SeerrCircuitBreaker.Threshold, _http.Requests.Count);
    }

    [Fact]
    public async Task Breaker_HalfOpensAfterAMinute_ClosingOnSuccess()
    {
        await TripAsync();
        _time.Advance(TimeSpan.FromSeconds(59));
        Assert.True((await Assert.ThrowsAsync<SeerrException>(() => _client.SearchAsync(Endpoint, 7, "x", 1, CancellationToken.None))).IsCircuitOpen);

        _time.Advance(TimeSpan.FromSeconds(2));
        _http.Respond = _ => FakeHttp.Json(EmptyPage);
        await _client.SearchAsync(Endpoint, 7, "x", 1, CancellationToken.None);

        // Closed again: it takes three new failures to reopen.
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
        for (var i = 0; i < SeerrCircuitBreaker.Threshold - 1; i++)
        {
            await Assert.ThrowsAsync<SeerrException>(() => _client.SearchAsync(Endpoint, 7, "x", 1, CancellationToken.None));
        }

        Assert.False(_client.Breaker.IsOpen);
    }

    [Fact]
    public async Task Breaker_HalfOpen_ReopensOnTheNextFailure()
    {
        await TripAsync();
        _time.Advance(SeerrCircuitBreaker.OpenFor + TimeSpan.FromSeconds(1));
        var before = _http.Requests.Count;

        await Assert.ThrowsAsync<SeerrException>(() => _client.SearchAsync(Endpoint, 7, "x", 1, CancellationToken.None));

        Assert.Equal(before + 1, _http.Requests.Count);
        Assert.True(_client.Breaker.IsOpen);
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.Conflict)]
    public async Task Breaker_Ignores4xx(HttpStatusCode status)
    {
        _http.Respond = _ => new HttpResponseMessage(status);

        for (var i = 0; i < 5; i++)
        {
            var error = await Assert.ThrowsAsync<SeerrException>(() => _client.GetMovieAsync(Endpoint, 7, 603, CancellationToken.None));
            Assert.Equal(status, error.Status);
        }

        Assert.False(_client.Breaker.IsOpen);
    }

    [Fact]
    public async Task Breaker_ASuccessResetsTheCount()
    {
        var calls = 0;
        _http.Respond = _ => ++calls % 3 == 0 ? FakeHttp.Json(EmptyPage) : new HttpResponseMessage(HttpStatusCode.BadGateway);

        for (var i = 0; i < 9; i++)
        {
            try
            {
                await _client.SearchAsync(Endpoint, 7, "x", 1, CancellationToken.None);
            }
            catch (SeerrException)
            {
                // Two failures, then a success, three times over.
            }
        }

        Assert.False(_client.Breaker.IsOpen);
        Assert.Equal(9, calls);
    }

    [Fact]
    public async Task Breaker_AdminCallsBypassIt()
    {
        await TripAsync();
        _http.Respond = r => r.RequestUri!.AbsolutePath.EndsWith("/status", StringComparison.Ordinal)
            ? FakeHttp.Json("""{"version":"3.5.1"}""")
            : FakeHttp.Json("""{"name":"J","serverId":"abc"}""");

        Assert.Equal("3.5.1", (await _client.GetStatusAsync(Endpoint, CancellationToken.None)).Version);
        Assert.NotNull(await _client.GetJellyfinServerAsync(Endpoint, CancellationToken.None));
        Assert.True(_client.Breaker.IsOpen);
    }

    [Fact]
    public async Task Breaker_AdminFailuresDontCount()
    {
        _http.Respond = _ => throw new HttpRequestException("down");

        for (var i = 0; i < 5; i++)
        {
            await Assert.ThrowsAsync<SeerrException>(() => _client.GetStatusAsync(Endpoint, CancellationToken.None));
        }

        Assert.False(_client.Breaker.IsOpen);
    }

    [Fact]
    public async Task Breaker_StillServesCachedDiscoverLists()
    {
        _http.Respond = _ => FakeHttp.Json(EmptyPage);
        var cached = await _client.DiscoverAsync(Endpoint, 7, SeerrDiscoverList.Trending, CancellationToken.None);
        await TripAsync();

        Assert.Same(cached, await _client.DiscoverAsync(Endpoint, 7, SeerrDiscoverList.Trending, CancellationToken.None));
        await Assert.ThrowsAsync<SeerrException>(() => _client.DiscoverAsync(Endpoint, 7, SeerrDiscoverList.PopularTv, CancellationToken.None));
    }

    private async Task TripAsync()
    {
        _http.Respond = _ => throw new HttpRequestException("down");
        for (var i = 0; i < SeerrCircuitBreaker.Threshold; i++)
        {
            await Assert.ThrowsAsync<SeerrException>(() => _client.SearchAsync(Endpoint, 7, "x", 1, CancellationToken.None));
        }

        Assert.True(_client.Breaker.IsOpen);
    }
}
