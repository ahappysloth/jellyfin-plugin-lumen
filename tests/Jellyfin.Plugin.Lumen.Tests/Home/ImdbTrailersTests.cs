using System.Net;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public sealed class ImdbTrailersTests : IDisposable
{
    private const string Id = "tt0133093";
    private const string Cdn = "https://imdb-video.media-imdb.com";
    private static readonly Uri Api = new("https://api.graphql.imdb.com/");

    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly ImdbStub _imdb = new();
    private readonly ImdbTrailers _trailers;

    public ImdbTrailersTests()
    {
        _config.Current.Returns(new PluginConfiguration { YouTubeTrailers = true });
        _imdb.Answer = _ => Answer(Video("Trailer", 150, ("1080p", Mp4("a1080")), ("720p", Mp4("a720")), ("480p", Mp4("a480"))));
        _trailers = new ImdbTrailers(_imdb.Factory, _config, _time, NullLogger<ImdbTrailers>.Instance);
    }

    public static TheoryData<string> Failures => ["403", "500", "302", "errors", "garbage", "throws", "timeout"];

    public void Dispose() => _imdb.Dispose();

    [Fact]
    public async Task AsksIMDbAsItsSiteDoes_ForTheTitleById_AndGetsThe720pMp4()
    {
        Assert.Equal(Mp4("a720"), await Get(Id));

        var (request, body) = Assert.Single(_imdb.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal(Api, request.RequestUri);
        Assert.Contains("Safari", request.Headers.UserAgent.ToString(), StringComparison.Ordinal);
        Assert.Equal("imdb-web-next", Assert.Single(request.Headers.GetValues("x-imdb-client-name")));
        Assert.Equal("https://www.imdb.com", Assert.Single(request.Headers.GetValues("Origin")));
        Assert.Equal("application/json", request.Content!.Headers.ContentType!.MediaType);

        // The id goes as a GraphQL variable, never into the query's text.
        using var json = JsonDocument.Parse(body);
        Assert.Equal(Id, json.RootElement.GetProperty("variables").GetProperty("id").GetString());
        Assert.DoesNotContain(Id, json.RootElement.GetProperty("query").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task PrefersATrailerOfAMinuteOrMore_OverAnEarlierTeaser_AndNeverAClip()
    {
        _imdb.Answer = _ => Answer(
            Video("Clip", 200, ("720p", Mp4("clip"))),
            Video("Featurette", 200, ("720p", Mp4("featurette"))),
            Video("Trailer", 30, ("720p", Mp4("teaser"))),
            Video("Trailer", 126, ("720p", Mp4("trailer"))),
            Video("Trailer", 140, ("720p", Mp4("second"))));

        Assert.Equal(Mp4("trailer"), await Get(Id));
    }

    [Fact]
    public async Task WithOnlyShortTrailers_TakesTheFirst()
    {
        _imdb.Answer = _ => Answer(Video("Clip", 200, ("720p", Mp4("clip"))), Video("Trailer", 30, ("720p", Mp4("one"))), Video("Trailer", null, ("720p", Mp4("two"))));

        Assert.Equal(Mp4("one"), await Get(Id));
    }

    [Fact]
    public async Task OnlyClips_IsNoTrailer()
    {
        _imdb.Answer = _ => Answer(Video("Clip", 200, ("720p", Mp4("clip"))));

        Assert.Null(await Get(Id));
    }

    [Theory]
    [InlineData("480p", "1080p,480p,AUTO")]
    [InlineData("1080p", "1080p,AUTO,270p")]
    [InlineData("SD", "SD,AUTO,270p")]
    public async Task FallsBackTo480p_Then1080p_ThenSD(string expected, string offered)
    {
        _imdb.Answer = _ => Answer(Video("Trailer", 120, offered.Split(',').Select(q => (q, q == "AUTO" ? Cdn + "/vi1/hls-master.m3u8" : Mp4(q))).ToArray()));

        Assert.Equal(Mp4(expected), await Get(Id));
    }

    [Fact]
    public async Task ATrailerWithNoMp4WeTake_IsPassedOverForTheNext()
    {
        _imdb.Answer = _ => Answer(
            Video("Trailer", 120, ("AUTO", Cdn + "/vi1/hls-master.m3u8"), ("270p", Mp4("tiny"))),
            Video("Trailer", 100, ("720p", "https://elsewhere.example/a.mp4")),
            Video("Trailer", 90, ("480p", Mp4("third"))));

        Assert.Equal(Mp4("third"), await Get(Id));
    }

    [Theory]
    [InlineData("https://imdb-video.media-imdb.com/vi1/a.mp4?Expires=1&Signature=x", true)]
    [InlineData("https://IMDB-VIDEO.media-imdb.com/vi1/a.MP4", true)]
    [InlineData("http://imdb-video.media-imdb.com/vi1/a.mp4", false)]
    [InlineData("https://imdb-video.media-imdb.com:8443/vi1/a.mp4", false)]
    [InlineData("https://imdb-video.media-imdb.com.evil.example/vi1/a.mp4", false)]
    [InlineData("https://evil.example/imdb-video.media-imdb.com/a.mp4", false)]
    [InlineData("https://user:pass@imdb-video.media-imdb.com/vi1/a.mp4", false)]
    [InlineData("https://imdb-video.media-imdb.com/vi1/hls-master.m3u8", false)]
    [InlineData("https://imdb-video.media-imdb.com/vi1/a.mp4#x", false)]
    [InlineData("javascript:alert(1)//a.mp4", false)]
    [InlineData("/vi1/a.mp4", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void OnlyAnMp4OnIMDbsVideoCdn_IsTaken(string? url, bool taken) =>
        Assert.Equal(taken, ImdbTrailers.AllowedUrl(url, ImdbTrailers.DefaultVideoOrigin) is not null);

    [Fact]
    public void TheTestsVideoOrigin_ReplacesIMDbs()
    {
        Assert.NotNull(ImdbTrailers.AllowedUrl("http://localhost:5221/imdb/video/a.mp4", "http://localhost:5221"));
        Assert.Null(ImdbTrailers.AllowedUrl(Mp4("a"), "http://localhost:5221"));
        Assert.Null(ImdbTrailers.AllowedUrl("http://localhost:5222/imdb/video/a.mp4", "http://localhost:5221"));
    }

    [Fact]
    public async Task AnAddressElsewhere_NeverReachesTheBrowser()
    {
        _imdb.Answer = _ => Answer(Video("Trailer", 120, ("720p", "https://evil.example/a.mp4"), ("480p", "http://imdb-video.media-imdb.com/a.mp4")));

        Assert.Null(await Get(Id));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("tt123456")]
    [InlineData("tt1234567890")]
    [InlineData("nm0000206")]
    [InlineData(" tt0133093")]
    [InlineData("tt0133093\"}")]
    [InlineData("tt013309３")]
    public async Task AnythingButAnIMDbTitleId_IsNotAsked(string? id)
    {
        Assert.Null(await Get(id));
        Assert.Empty(_imdb.Requests);
    }

    [Theory]
    [InlineData("tt0133093")]
    [InlineData("tt32375763")]
    [InlineData("tt123456789")]
    public void TitleIds_AreTtAnd7To9Digits(string id) => Assert.True(ImdbTrailers.IsTitleId(id));

    [Theory]
    [InlineData(false, true, true)]
    [InlineData(true, false, true)]
    [InlineData(true, true, false)]
    public async Task LumenPreviewsOrTheSettingOff_NothingAsked(bool enabled, bool previews, bool online)
    {
        _config.Current.Returns(new PluginConfiguration { Enabled = enabled, TrailerPreview = previews, YouTubeTrailers = online });

        Assert.Null(await Get(Id));
        Assert.Empty(_imdb.Requests);
    }

    [Fact]
    public void IdOf_ReadsAMovieOrShowsImdbId_AndNothingElse()
    {
        var movie = TestData.Movie("m");
        movie.SetProviderId(MetadataProvider.Imdb, "tt0133093");
        var series = TestData.Series("s");
        series.SetProviderId(MetadataProvider.Imdb, "tt0903747");
        var episode = TestData.Episode(series, 1, 1);
        episode.SetProviderId(MetadataProvider.Imdb, "tt0959621");
        var wrong = TestData.Movie("w");
        wrong.ProviderIds[nameof(MetadataProvider.Imdb)] = "0133093";

        Assert.Equal("tt0133093", ImdbTrailers.IdOf(movie));
        Assert.Equal("tt0903747", ImdbTrailers.IdOf(series));
        Assert.Null(ImdbTrailers.IdOf(episode));
        Assert.Null(ImdbTrailers.IdOf(wrong));
        Assert.Null(ImdbTrailers.IdOf(TestData.Movie("none")));
    }

    [Fact]
    public async Task ATrailer_IsCachedForEveryone_UntilAnHourBeforeItsAddressExpires()
    {
        // As IMDb signs them: for a day. So 23 hours.
        var url = Mp4("signed", TestData.Now + TimeSpan.FromHours(24));
        _imdb.Answer = _ => Answer(Video("Trailer", 120, ("720p", url)));

        Assert.Equal(url, await Get(Id));
        _time.Advance(TimeSpan.FromHours(23) - TimeSpan.FromMinutes(1));
        Assert.Equal(url, await Get(Id));
        Assert.Single(_imdb.Requests);

        _time.Advance(TimeSpan.FromMinutes(2));
        await Get(Id);
        Assert.Equal(2, _imdb.Requests.Count);
    }

    [Theory]
    [InlineData(48)]
    [InlineData(null)]
    public async Task ATrailer_IsCachedForADayAtMost(int? expiresInHours)
    {
        var url = Mp4("a", expiresInHours is { } h ? TestData.Now + TimeSpan.FromHours(h) : null);
        _imdb.Answer = _ => Answer(Video("Trailer", 120, ("720p", url)));

        await Get(Id);
        _time.Advance(ImdbTrailers.HitTtl - TimeSpan.FromMinutes(1));
        await Get(Id);
        Assert.Single(_imdb.Requests);

        _time.Advance(TimeSpan.FromMinutes(2));
        await Get(Id);
        Assert.Equal(2, _imdb.Requests.Count);
    }

    [Fact]
    public async Task AnAddressAboutToExpire_IsNotPassedOn_AndAskedForAgainSoon()
    {
        _imdb.Answer = _ => Answer(Video("Trailer", 120, ("720p", Mp4("old", TestData.Now + TimeSpan.FromMinutes(50)))));

        Assert.Null(await Get(Id));
        _time.Advance(ImdbTrailers.FailureTtl + TimeSpan.FromSeconds(1));
        _imdb.Answer = _ => Answer(Video("Trailer", 120, ("720p", Mp4("new"))));
        Assert.Equal(Mp4("new"), await Get(Id));
    }

    [Theory]
    [InlineData("""{"data":{"title":null}}""")]
    [InlineData("""{"data":{"title":{"primaryVideos":{"edges":[]}}}}""")]
    [InlineData("""{"data":{"title":{"primaryVideos":null}}}""")]
    [InlineData("""{"data":{"title":{"primaryVideos":{"edges":[null,{"node":null},{"node":{"contentType":null}}]}}}}""")]
    public async Task NoTrailer_IsCachedForSomeHours(string answer)
    {
        _imdb.Answer = _ => Json(answer);

        Assert.Null(await Get(Id));
        _time.Advance(ImdbTrailers.MissTtl - TimeSpan.FromMinutes(1));
        Assert.Null(await Get(Id));
        Assert.Single(_imdb.Requests);

        _time.Advance(TimeSpan.FromMinutes(2));
        await Get(Id);
        Assert.Equal(2, _imdb.Requests.Count);
    }

    [Theory]
    [MemberData(nameof(Failures))]
    public async Task IMDbFailing_IsNoTrailer_CachedForFiveMinutes_AndNeverThrows(string failure)
    {
        _imdb.Answer = _ => Fail(failure);

        Assert.Null(await Get(Id));
        _time.Advance(ImdbTrailers.FailureTtl - TimeSpan.FromSeconds(1));
        Assert.Null(await Get(Id));
        Assert.Single(_imdb.Requests);

        _imdb.Answer = _ => Answer(Video("Trailer", 120, ("720p", Mp4("back"))));
        _time.Advance(TimeSpan.FromSeconds(2));
        Assert.Equal(Mp4("back"), await Get(Id));
    }

    [Fact]
    public async Task ConcurrentLookups_AskIMDbOnce_AndAllGetTheAnswer()
    {
        var answer = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _imdb.Gate = answer.Task;
        _imdb.Answer = _ => Answer(Video("Trailer", 120, ("720p", Mp4("a"))));

        var first = Get(Id);
        var second = Get(Id);
        var other = Get("tt0234215");
        await _imdb.WaitForRequests(2);
        Assert.False(first.IsCompleted);
        Assert.Equal(2, _imdb.Requests.Count);

        answer.SetResult();
        Assert.Equal(Mp4("a"), await first);
        Assert.Equal(Mp4("a"), await second);
        Assert.Equal(Mp4("a"), await other);

        Assert.Equal(Mp4("a"), await Get(Id));
        Assert.Equal(2, _imdb.Requests.Count);
    }

    [Fact]
    public async Task ACallerThatGivesUp_DoesNotCancelTheLookupForTheOthers()
    {
        var answer = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _imdb.Gate = answer.Task;
        _imdb.Answer = _ => Answer(Video("Trailer", 120, ("720p", Mp4("a"))));
        using var cancel = new CancellationTokenSource();

        var leaving = _trailers.GetAsync(Id, cancel.Token);
        var staying = Get(Id);
        await cancel.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => leaving);

        answer.SetResult();
        Assert.Equal(Mp4("a"), await staying);
        Assert.Single(_imdb.Requests);
    }

    [Fact]
    public async Task Cache_IsBounded()
    {
        for (var n = 1; n <= ImdbTrailers.Capacity + 25; n++)
        {
            await Get(TitleId(n));
        }

        Assert.Equal(ImdbTrailers.Capacity, _trailers.CachedCount);

        // The newest stayed, the oldest went.
        _imdb.Requests.Clear();
        await Get(TitleId(ImdbTrailers.Capacity + 25));
        Assert.Empty(_imdb.Requests);
        await Get(TitleId(1));
        Assert.Single(_imdb.Requests);
    }

    [Fact]
    public async Task Check_AsksPastTheCacheAndTheSetting()
    {
        _config.Current.Returns(new PluginConfiguration());

        Assert.Equal(new ImdbCheck(Mp4("a720"), null), await _trailers.CheckAsync(Id, CancellationToken.None));
        Assert.Equal(new ImdbCheck(Mp4("a720"), null), await _trailers.CheckAsync(Id, CancellationToken.None));
        Assert.Equal(2, _imdb.Requests.Count);
    }

    [Fact]
    public async Task Check_SaysWhatWentWrong_WithoutAnAddress()
    {
        _imdb.Answer = _ => Fail("403");
        var refused = await _trailers.CheckAsync(Id, CancellationToken.None);
        Assert.Equal((HttpStatusCode?)HttpStatusCode.Forbidden, refused.Status);
        Assert.Equal("IMDb answered with HTTP 403.", refused.Problem);

        _imdb.Answer = _ => Fail("timeout");
        var slow = await _trailers.CheckAsync(Id, CancellationToken.None);
        Assert.Equal("IMDb did not answer within 4 seconds.", slow.Problem);

        _imdb.Answer = _ => Fail("errors");
        Assert.Equal("IMDb didn't understand Lumen's question.", (await _trailers.CheckAsync(Id, CancellationToken.None)).Problem);

        _imdb.Answer = _ => Json("""{"data":{"title":null}}""");
        Assert.Equal(new ImdbCheck(null, null), await _trailers.CheckAsync(Id, CancellationToken.None));
    }

    [Theory]
    [InlineData("https://x/a.mp4?Expires=1794667866&Signature=s", 1794667866L)]
    [InlineData("https://x/a.mp4?Signature=s&Expires=5", 5L)]
    [InlineData("https://x/a.mp4", null)]
    [InlineData("https://x/a.mp4?Expires=soon", null)]
    [InlineData("https://x/a.mp4?Expires=-5", null)]
    [InlineData("https://x/a.mp4?NotExpires=5", null)]
    public void ExpiresOf_ReadsTheSignedAddressesExpiry(string url, long? seconds) =>
        Assert.Equal(seconds is { } s ? DateTimeOffset.FromUnixTimeSeconds(s) : null, ImdbTrailers.ExpiresOf(new Uri(url)));

    [Fact]
    public void AnExampleOfIMDbsRealAnswer_GivesIts720pTrailer()
    {
        // Trimmed from IMDb's answer for tt1745960 on 13 Nov 2026: labels and addresses as IMDb gives them.
        using var json = JsonDocument.Parse(
            """
            {"primaryVideos":{"edges":[
              {"node":{"runtime":{"value":151},"contentType":{"displayName":{"value":"Trailer"}},"playbackURLs":[
                {"url":"https://imdb-video.media-imdb.com/vi632472089/1434659529640-260ouz-1648562542211.mp4?Expires=1794667866&Signature=a~b__&Key-Pair-Id=K","displayName":{"value":"1080p"}},
                {"url":"https://imdb-video.media-imdb.com/vi632472089/1434659454657-dx9ykf-1648562542211.mp4?Expires=1794667866&Signature=a~b__&Key-Pair-Id=K","displayName":{"value":"SD"}},
                {"url":"https://imdb-video.media-imdb.com/vi632472089/hls-1648562542211-master.m3u8?Expires=1794667866&Signature=a~b__&Key-Pair-Id=K","displayName":{"value":"AUTO"}},
                {"url":"https://imdb-video.media-imdb.com/vi632472089/1434659379400-8cjq25-1648562542211.mp4?Expires=1794667866&Signature=a~b__&Key-Pair-Id=K","displayName":{"value":"720p"}},
                {"url":"https://imdb-video.media-imdb.com/vi632472089/1434659607842-pgv4ql-1648562542211.mp4?Expires=1794667866&Signature=a~b__&Key-Pair-Id=K","displayName":{"value":"480p"}}]}}]}}
            """);

        var trailer = ImdbTrailers.Pick(json.RootElement, ImdbTrailers.DefaultVideoOrigin);

        Assert.Equal(
            "https://imdb-video.media-imdb.com/vi632472089/1434659379400-8cjq25-1648562542211.mp4?Expires=1794667866&Signature=a~b__&Key-Pair-Id=K",
            trailer!.Url);
        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1794667866), trailer.Expires);
    }

    private static string TitleId(int n) => "tt" + (1000000 + n).ToString(System.Globalization.CultureInfo.InvariantCulture);

    private static string Mp4(string name, DateTimeOffset? expires = null) =>
        Cdn + "/vi1/" + name + ".mp4" + (expires is { } e ? "?Expires=" + e.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture) + "&Signature=a~b__&Key-Pair-Id=K" : string.Empty);

    private static object Video(string type, int? seconds, params (string Quality, string Url)[] files) => new
    {
        runtime = seconds is { } s ? new { value = s } : null,
        contentType = new { displayName = new { value = type } },
        playbackURLs = files.Select(f => new { url = f.Url, displayName = new { value = f.Quality } }).ToArray(),
    };

    private static HttpResponseMessage Answer(params object[] videos) =>
        Json(JsonSerializer.Serialize(new { data = new { title = new { primaryVideos = new { edges = videos.Select(v => new { node = v }).ToArray() } } } }));

    private static HttpResponseMessage Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static HttpResponseMessage Fail(string how) => how switch
    {
        "403" => new HttpResponseMessage(HttpStatusCode.Forbidden) { Content = new StringContent("<html>403 Forbidden</html>") },
        "500" => new HttpResponseMessage(HttpStatusCode.InternalServerError),
        "302" => new HttpResponseMessage(HttpStatusCode.Found),
        "errors" => Json("""{"errors":[{"message":"Cannot query field"}]}"""),
        "garbage" => Json("<html>"),
        "throws" => throw new HttpRequestException("Connection refused (api.graphql.imdb.com:443)"),
        _ => throw new TaskCanceledException("timed out"),
    };

    private Task<string?> Get(string? id) => _trailers.GetAsync(id, CancellationToken.None);

    /// <summary>IMDb's API: answers from <see cref="Answer"/>, recording each request and its body.</summary>
    private sealed class ImdbStub : HttpMessageHandler
    {
        private readonly SemaphoreSlim _arrived = new(0);

        public List<(HttpRequestMessage Request, string Body)> Requests { get; } = [];

        public Func<HttpRequestMessage, HttpResponseMessage> Answer { get; set; } = _ => new HttpResponseMessage(HttpStatusCode.NotFound);

        /// <summary>Gets or sets what every request waits for before it's answered.</summary>
        public Task? Gate { get; set; }

        public IHttpClientFactory Factory
        {
            get
            {
                var factory = Substitute.For<IHttpClientFactory>();
                factory.CreateClient(ImdbTrailers.HttpClientName).Returns(_ => new HttpClient(this, disposeHandler: false));
                return factory;
            }
        }

        public async Task WaitForRequests(int count)
        {
            for (var i = 0; i < count; i++)
            {
                Assert.True(await _arrived.WaitAsync(TimeSpan.FromSeconds(5)));
            }
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
            lock (Requests)
            {
                Requests.Add((request, body));
            }

            _arrived.Release();
            if (Gate is { } gate)
            {
                await gate;
            }

            return Answer(request);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _arrived.Dispose();
            }

            base.Dispose(disposing);
        }
    }
}
