using System.Net;
using Jellyfin.Plugin.Lumen.Requests;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public sealed class SeerrClientTests : IDisposable
{
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/base/"), "key123");
    private readonly FakeHttp _http = new();

    [Fact]
    public async Task Status_SendsTheApiKeyAndReadsTheVersion()
    {
        _http.Respond = _ => FakeHttp.Json("""{"version":"3.5.1","commitTag":"abc"}""");

        var status = await Client().GetStatusAsync(Endpoint, CancellationToken.None);

        Assert.Equal("3.5.1", status.Version);
        var request = Assert.Single(_http.Requests);
        Assert.Equal("http://seerr:5055/base/api/v1/status", request.RequestUri!.ToString());
        Assert.Equal("key123", Assert.Single(request.Headers.GetValues("X-Api-Key")));
        Assert.False(request.Headers.Contains("X-Api-User"));
    }

    [Fact]
    public async Task UserLookup_KeepsOnlyIdAndPermissions()
    {
        var jellyfinId = Guid.NewGuid();
        _http.Respond = _ => FakeHttp.Json("""{"id":7,"permissions":32,"jellyfinAuthToken":"secret","plexToken":"secret"}""");

        var user = await Client().GetUserByJellyfinIdAsync(Endpoint, jellyfinId, CancellationToken.None);

        Assert.Equal(new SeerrUser(7, 32), user);
        Assert.EndsWith("/api/v1/user/jellyfin/" + jellyfinId.ToString("N"), _http.Requests[0].RequestUri!.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task JellyfinServer_KeepsOnlyNameAndServerId()
    {
        _http.Respond = _ => FakeHttp.Json("""{"name":"Home","ip":"10.0.0.2","serverId":"abc","apiKey":"secret"}""");

        var server = await Client().GetJellyfinServerAsync(Endpoint, CancellationToken.None);

        Assert.Equal(new SeerrJellyfinServer("Home", "abc"), server);
        Assert.EndsWith("/api/v1/settings/jellyfin", _http.Requests[0].RequestUri!.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task UserLookup_404MeansNoAccount()
    {
        _http.Respond = _ => FakeHttp.Json("""{"message":"not found"}""", HttpStatusCode.NotFound);

        Assert.Null(await Client().GetUserByJellyfinIdAsync(Endpoint, Guid.NewGuid(), CancellationToken.None));
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, "rejected the API key")]
    [InlineData(HttpStatusCode.InternalServerError, "HTTP 500")]
    public async Task Errors_BecomeSeerrExceptionsWithReadableMessages(HttpStatusCode status, string message)
    {
        _http.Respond = _ => FakeHttp.Json("{}", status);

        var error = await Assert.ThrowsAsync<SeerrException>(() => Client().GetStatusAsync(Endpoint, CancellationToken.None));

        Assert.Contains(message, error.Message, StringComparison.Ordinal);
        Assert.Equal(status, error.Status);
    }

    [Fact]
    public async Task NonJsonAnswer_SuggestsTheWrongAddress()
    {
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html>router login</html>") };

        var error = await Assert.ThrowsAsync<SeerrException>(() => Client().GetStatusAsync(Endpoint, CancellationToken.None));

        Assert.Contains("Seerr's address", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Unreachable_IsASeerrException()
    {
        _http.Respond = _ => throw new HttpRequestException("connection refused");

        var error = await Assert.ThrowsAsync<SeerrException>(() => Client().GetStatusAsync(Endpoint, CancellationToken.None));

        Assert.Contains("connection refused", error.Message, StringComparison.Ordinal);
    }

    public void Dispose() => _http.Dispose();

    private SeerrClient Client() => new(_http.Factory);
}
