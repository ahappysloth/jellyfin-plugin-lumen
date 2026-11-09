using System.Net;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

/// <summary>Where the API key may go, the breaker's scope, and who shares cached Seerr answers.</summary>
public sealed class SeerrClientSafetyTests : IDisposable
{
    private const string EmptyPage = """{"page":1,"totalPages":1,"results":[]}""";
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/"), "key123");
    private readonly FakeHttp _http = new();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly SeerrClient _client;

    public SeerrClientSafetyTests()
    {
        _client = new SeerrClient(_http.Factory, _time, NullLogger<SeerrClient>.Instance);
    }

    public void Dispose() => _http.Dispose();

    [Theory]
    [InlineData(HttpStatusCode.Found)]
    [InlineData(HttpStatusCode.TemporaryRedirect)]
    [InlineData(HttpStatusCode.PermanentRedirect)]
    public async Task ARedirect_IsAnError_ThatSaysToUseTheDirectAddress(HttpStatusCode status)
    {
        _http.Respond = _ => new HttpResponseMessage(status) { Headers = { Location = new Uri("https://auth.example.com/login") } };

        var error = await Assert.ThrowsAsync<SeerrException>(() => _client.GetMovieAsync(Endpoint, 7, 603, CancellationToken.None));

        Assert.Equal(status, error.Status);
        Assert.Contains("redirected", error.Message, StringComparison.Ordinal);
        Assert.Single(_http.Requests);
        Assert.False(_client.BreakerFor(Endpoint).IsOpen);
    }

    [Fact]
    public async Task TheRegisteredClient_NeverFollowsARedirect_SoTheKeyStaysWithSeerr()
    {
        string? keySeenElsewhere = null;
        var elsewhereHits = 0;
        await using var elsewhere = await StartServerAsync(context =>
        {
            Interlocked.Increment(ref elsewhereHits);
            keySeenElsewhere = context.Request.Headers["X-Api-Key"];
            return context.Response.WriteAsync("{}");
        });
        string? userAgent = null;
        await using var seerr = await StartServerAsync(context =>
        {
            userAgent = context.Request.Headers.UserAgent;
            context.Response.Redirect(elsewhere.Urls.First() + "/login");
            return Task.CompletedTask;
        });

        var services = new ServiceCollection().AddLogging();
        new ServiceRegistrator().RegisterServices(services, Substitute.For<IServerApplicationHost>());
        await using var provider = services.BuildServiceProvider();
        var client = new SeerrClient(provider.GetRequiredService<IHttpClientFactory>(), TimeProvider.System, NullLogger<SeerrClient>.Instance);
        var endpoint = new SeerrEndpoint(new Uri(seerr.Urls.First() + "/"), "secret-key");

        var error = await Assert.ThrowsAsync<SeerrException>(() => client.GetMovieAsync(endpoint, 7, 603, CancellationToken.None));

        Assert.Equal(HttpStatusCode.Redirect, error.Status);
        Assert.Equal(0, elsewhereHits);
        Assert.Null(keySeenElsewhere);
        Assert.StartsWith("Jellyfin-Plugin-Lumen/", userAgent, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AdminUserLookups_BypassAnOpenBreaker_AndLeaveItOpen()
    {
        await TripAsync(Endpoint);
        _http.Respond = _ => FakeHttp.Json("""{"id":2,"permissions":32}""");
        var before = _http.Requests.Count;

        var user = await _client.GetUserByJellyfinIdForAdminAsync(Endpoint, Guid.NewGuid(), CancellationToken.None);

        Assert.Equal(new SeerrUser(2, 32), user);
        Assert.Equal(before + 1, _http.Requests.Count);
        Assert.True(_client.BreakerFor(Endpoint).IsOpen);
        Assert.True((await Assert.ThrowsAsync<SeerrException>(() => _client.GetUserByJellyfinIdAsync(Endpoint, Guid.NewGuid(), CancellationToken.None))).IsCircuitOpen);
    }

    [Fact]
    public async Task AdminUserLookupFailures_DontTripTheBreaker()
    {
        _http.Respond = _ => new HttpResponseMessage(HttpStatusCode.BadGateway);

        for (var i = 0; i < SeerrCircuitBreaker.Threshold + 2; i++)
        {
            await Assert.ThrowsAsync<SeerrException>(() => _client.GetUserByJellyfinIdForAdminAsync(Endpoint, Guid.NewGuid(), CancellationToken.None));
        }

        Assert.False(_client.BreakerFor(Endpoint).IsOpen);
    }

    [Fact]
    public async Task TheBreaker_IsPerEndpoint()
    {
        var other = new SeerrEndpoint(new Uri("http://other-seerr:5055/"), "key123");
        await TripAsync(Endpoint);
        _http.Respond = _ => FakeHttp.Json(EmptyPage);

        await _client.SearchAsync(other, 7, "x", 1, CancellationToken.None);

        Assert.True(_client.BreakerFor(Endpoint).IsOpen);
        Assert.False(_client.BreakerFor(other).IsOpen);
    }

    [Fact]
    public async Task CachedAnswers_AreOnlySharedBetweenUsersWithTheSameLanguageAndRegion()
    {
        await LookUpAsync(1, """{"locale":"de","region":"DE","originalLanguage":"de"}""");
        await LookUpAsync(2, """{"locale":"en","region":"US","originalLanguage":null}""");
        await LookUpAsync(3, """{"locale":"en","region":"US"}""");
        _http.Requests.Clear();
        _http.Respond = _ => FakeHttp.Json(EmptyPage);

        var german = await _client.DiscoverAsync(Endpoint, 1, SeerrDiscoverList.Trending, CancellationToken.None);
        var english = await _client.DiscoverAsync(Endpoint, 2, SeerrDiscoverList.Trending, CancellationToken.None);
        var alsoEnglish = await _client.DiscoverAsync(Endpoint, 3, SeerrDiscoverList.Trending, CancellationToken.None);

        Assert.NotSame(german, english);
        Assert.Same(english, alsoEnglish);
        Assert.Equal(["1", "2"], _http.Requests.Select(r => Assert.Single(r.Headers.GetValues("X-Api-User"))));
    }

    [Fact]
    public async Task UsersWhoseSettingsAreUnknown_GetCachedAnswersOfTheirOwn()
    {
        await LookUpAsync(1, null);
        _http.Requests.Clear();
        _http.Respond = _ => FakeHttp.Json("""{"id":603,"title":"The Matrix"}""");

        await _client.GetTitleSummaryAsync(Endpoint, 1, "movie", 603, CancellationToken.None);
        await _client.GetTitleSummaryAsync(Endpoint, 2, "movie", 603, CancellationToken.None); // never looked up
        await _client.GetTitleSummaryAsync(Endpoint, 1, "movie", 603, CancellationToken.None);

        Assert.Equal(["1", "2"], _http.Requests.Select(r => Assert.Single(r.Headers.GetValues("X-Api-User"))));
    }

    [Fact]
    public async Task OddlyShapedSettings_DontBreakTheUserLookup()
    {
        await LookUpAsync(1, """{"locale":5,"region":{"code":"DE"},"originalLanguage":["de"]}""");
        await LookUpAsync(2, "\"not an object\"");
    }

    [Fact]
    public void KeyBearingRecords_NeverPrintTheKey()
    {
        var access = new RequestAccess(true, true, true, 7, Endpoint);

        Assert.DoesNotContain("key123", Endpoint.ToString(), StringComparison.Ordinal);
        Assert.Contains("http://seerr:5055/", Endpoint.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain("key123", access.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain("key123", Endpoint.CacheKey, StringComparison.Ordinal);
        Assert.Equal(Endpoint, Endpoint with { }); // equality still covers the key
        Assert.NotEqual(Endpoint, Endpoint with { ApiKey = "other" });
    }

    private static async Task<WebApplication> StartServerAsync(RequestDelegate handler)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var app = builder.Build();
        app.Run(handler);
        await app.StartAsync();
        return app;
    }

    /// <summary>Looks up Seerr user <paramref name="seerrUserId"/>, whose settings are <paramref name="settings"/> (JSON).</summary>
    private async Task LookUpAsync(int seerrUserId, string? settings)
    {
        var body = settings is null
            ? $$"""{"id":{{seerrUserId}},"permissions":32}"""
            : $$"""{"id":{{seerrUserId}},"permissions":32,"settings":{{settings}}}""";
        _http.Respond = _ => FakeHttp.Json(body);
        Assert.Equal(seerrUserId, (await _client.GetUserByJellyfinIdAsync(Endpoint, Guid.NewGuid(), CancellationToken.None))!.Id);
    }

    private async Task TripAsync(SeerrEndpoint endpoint)
    {
        _http.Respond = _ => throw new HttpRequestException("down");
        for (var i = 0; i < SeerrCircuitBreaker.Threshold; i++)
        {
            await Assert.ThrowsAsync<SeerrException>(() => _client.SearchAsync(endpoint, 7, "x", 1, CancellationToken.None));
        }

        Assert.True(_client.BreakerFor(endpoint).IsOpen);
    }
}
