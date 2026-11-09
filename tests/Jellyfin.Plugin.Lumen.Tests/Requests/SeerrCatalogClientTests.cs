using System.Net;
using System.Text.Json;
using Jellyfin.Plugin.Lumen.Requests;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public sealed class SeerrCatalogClientTests : IDisposable
{
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/base/"), "key123");
    private readonly FakeHttp _http = new();
    private string? _postedBody;

    [Fact]
    public async Task Search_EscapesTheQuery_AndActsAsTheUser()
    {
        _http.Respond = _ => FakeHttp.Json("""{"page":2,"totalPages":3,"totalResults":41,"results":[{"mediaType":"movie","id":603,"title":"The Matrix","genreIds":[28,878]}]}""");

        var page = await Client().SearchAsync(Endpoint, 7, "a b&c=d/é", 2, CancellationToken.None);

        var request = Assert.Single(_http.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("http://seerr:5055/base/api/v1/search?query=a%20b%26c%3Dd%2F%C3%A9&page=2", request.RequestUri!.AbsoluteUri);
        Assert.Equal("key123", Assert.Single(request.Headers.GetValues("X-Api-Key")));
        Assert.Equal("7", Assert.Single(request.Headers.GetValues("X-Api-User")));
        Assert.Equal(2, page.Page);
        Assert.Equal(3, page.TotalPages);
        var result = Assert.Single(page.Results!);
        Assert.Equal(("movie", 603, "The Matrix"), (result.MediaType, result.Id, result.Title));
        Assert.Equal([28, 878], result.GenreIds);
    }

    [Fact]
    public async Task MovieTvAndRecommendations_UseTheirPaths_AsTheUser()
    {
        _http.Respond = r => r.RequestUri!.AbsolutePath.EndsWith("recommendations", StringComparison.Ordinal)
            ? FakeHttp.Json("""{"page":1,"totalPages":1,"results":[]}""")
            : FakeHttp.Json("""{"id":1399,"name":"Show","seasons":[{"seasonNumber":1,"name":"Season 1","episodeCount":10}],"mediaInfo":{"status":4,"jellyfinMediaId":"abc","requests":[{"status":2,"seasons":[{"seasonNumber":2}]}]}}""");
        var client = Client();

        await client.GetMovieAsync(Endpoint, 7, 603, CancellationToken.None);
        var tv = await client.GetTvAsync(Endpoint, 7, 1399, CancellationToken.None);
        await client.GetRecommendationsAsync(Endpoint, 7, "tv", 1399, CancellationToken.None);

        Assert.Equal(
            ["/base/api/v1/movie/603", "/base/api/v1/tv/1399", "/base/api/v1/tv/1399/recommendations?page=1"],
            _http.Requests.Select(r => r.RequestUri!.PathAndQuery));
        Assert.All(_http.Requests, r => Assert.Equal("7", Assert.Single(r.Headers.GetValues("X-Api-User"))));
        Assert.Equal(4, tv.MediaInfo!.Status);
        Assert.Equal(2, tv.MediaInfo.Requests![0].Seasons![0].SeasonNumber);
        Assert.Equal(10, tv.Seasons![0].EpisodeCount);
    }

    [Fact]
    public async Task Recommendations_RejectUnknownMediaTypes()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => Client().GetRecommendationsAsync(Endpoint, 7, "person", 1, CancellationToken.None));
        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task Request_Movie_PostsWithoutSeasonsOrUserId()
    {
        RespondToPost("""{"id":11,"status":1,"media":{"status":2}}""", HttpStatusCode.Created);

        var result = await Client().CreateRequestAsync(Endpoint, 7, "movie", 603, [1, 2], CancellationToken.None);

        Assert.Equal(new SeerrRequestResult(11, 1, 2), result);
        var request = Assert.Single(_http.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("http://seerr:5055/base/api/v1/request", request.RequestUri!.AbsoluteUri);
        Assert.Equal("7", Assert.Single(request.Headers.GetValues("X-Api-User")));
        Assert.Equal("key123", Assert.Single(request.Headers.GetValues("X-Api-Key")));
        using var body = JsonDocument.Parse(_postedBody!);
        Assert.Equal(["mediaType", "mediaId", "is4k"], body.RootElement.EnumerateObject().Select(p => p.Name));
        Assert.Equal("movie", body.RootElement.GetProperty("mediaType").GetString());
        Assert.Equal(603, body.RootElement.GetProperty("mediaId").GetInt32());
        Assert.False(body.RootElement.GetProperty("is4k").GetBoolean());
    }

    [Fact]
    public async Task Request_Tv_SendsSeasonsOrAll()
    {
        RespondToPost("""{"id":12,"status":2,"media":{"status":3}}""", HttpStatusCode.Created);
        var client = Client();

        await client.CreateRequestAsync(Endpoint, 7, "tv", 1399, [2, 3], CancellationToken.None);
        using (var seasons = JsonDocument.Parse(_postedBody!))
        {
            Assert.Equal([2, 3], seasons.RootElement.GetProperty("seasons").EnumerateArray().Select(e => e.GetInt32()));
            Assert.False(seasons.RootElement.TryGetProperty("userId", out _));
        }

        foreach (var none in new[] { null, Array.Empty<int>() })
        {
            await client.CreateRequestAsync(Endpoint, 7, "tv", 1399, none, CancellationToken.None);
            using var all = JsonDocument.Parse(_postedBody!);
            Assert.Equal("all", all.RootElement.GetProperty("seasons").GetString());
            Assert.False(all.RootElement.GetProperty("is4k").GetBoolean());
        }
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, "Quota exceeded.")]
    [InlineData(HttpStatusCode.Conflict, "Request for this media already exists.")]
    [InlineData(HttpStatusCode.Accepted, "No seasons available to request")]
    public async Task Request_Errors_CarrySeerrsMessage(HttpStatusCode status, string message)
    {
        RespondToPost(JsonSerializer.Serialize(new { message }), status);

        var error = await Assert.ThrowsAsync<SeerrException>(() => Client().CreateRequestAsync(Endpoint, 7, "tv", 1, null, CancellationToken.None));

        Assert.Equal(status, error.Status);
        Assert.Equal(message, error.SeerrMessage);
        Assert.DoesNotContain("key123", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Errors_WithoutAJsonMessage_HaveNoSeerrMessage()
    {
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.BadGateway) { Content = new StringContent("<html>bad gateway</html>") };

        var error = await Assert.ThrowsAsync<SeerrException>(() => Client().SearchAsync(Endpoint, 7, "x", 1, CancellationToken.None));

        Assert.Equal(HttpStatusCode.BadGateway, error.Status);
        Assert.Null(error.SeerrMessage);
    }

    [Fact]
    public async Task Get_202_IsNotAnError()
    {
        _http.Respond = _ => FakeHttp.Json("""{"page":1,"totalPages":0,"results":[]}""", HttpStatusCode.Accepted);

        var page = await Client().SearchAsync(Endpoint, 7, "x", 1, CancellationToken.None);

        Assert.Empty(page.Results!);
    }

    public void Dispose() => _http.Dispose();

    private void RespondToPost(string json, HttpStatusCode status) =>
        _http.Respond = r =>
        {
            _postedBody = r.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return FakeHttp.Json(json, status);
        };

    private SeerrClient Client() => new(_http.Factory);
}
