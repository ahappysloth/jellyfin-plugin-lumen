using System.Net;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class YouTubeTrailersTests
{
    private const int SeerrUserId = 7;
    private const string OwnId = "ownTrailer1";
    private const string SeerrId = "seerrTrail1";
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/"), "k");

    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly ISeerrUserMap _users = Substitute.For<ISeerrUserMap>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly User _user = TestData.User();
    private readonly YouTubeTrailers _trailers;

    public YouTubeTrailersTests()
    {
        _config.Current.Returns(WithSeerr());
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, SeerrUserId, Endpoint));
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(Title(Video(SeerrId)));
        _trailers = new YouTubeTrailers(_config, _seerr, _users, _time, NullLogger<YouTubeTrailers>.Instance);
    }

    [Fact]
    public async Task SettingOff_NoTrailer_AndNothingAsked()
    {
        _config.Current.Returns(new PluginConfiguration { RequestsEnabled = true, SeerrUrl = "http://seerr:5055", SeerrApiKey = "k" });

        Assert.Null(await Get(Movie(603, "https://www.youtube.com/watch?v=" + OwnId)));
        Assert.Empty(_seerr.ReceivedCalls());
        Assert.Empty(_users.ReceivedCalls());
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task LumenOrPreviewsOff_NoTrailer(bool enabled, bool previews)
    {
        var config = WithSeerr();
        config.Enabled = enabled;
        config.TrailerPreview = previews;
        _config.Current.Returns(config);

        Assert.Null(await Get(Movie(603, "https://www.youtube.com/watch?v=" + OwnId)));
    }

    [Fact]
    public async Task ItemsOwnTrailer_ComesFirst_WithoutSeerr()
    {
        Assert.Equal(OwnId, await Get(Movie(603, "https://www.youtube.com/watch?v=" + OwnId)));
        Assert.Empty(_seerr.ReceivedCalls());
        Assert.Empty(_users.ReceivedCalls());
    }

    [Fact]
    public async Task ItemsOwnTrailer_WorksWithoutSeerrSetUp()
    {
        _config.Current.Returns(new PluginConfiguration { YouTubeTrailers = true });

        Assert.Equal(OwnId, await Get(Movie(null, "https://youtu.be/" + OwnId)));
        Assert.Null(await Get(Movie(603)));
        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Fact]
    public async Task ItemsOwnTrailers_SkipWhatIsNotAYouTubeVideo()
    {
        var movie = Movie(603, "https://vimeo.com/12345", "https://www.youtube.com/playlist?list=PL1", "https://www.youtube.com/watch?v=" + OwnId);

        Assert.Equal(OwnId, await Get(movie));
    }

    [Fact]
    public async Task WithoutOwnTrailer_AsksSeerr_AsTheUser_ByTmdbId()
    {
        Assert.Equal(SeerrId, await Get(Movie(603)));
        await _seerr.Received(1).GetTitleSummaryAsync(Endpoint, SeerrUserId, CatalogMediaType.Movie, 603, Arg.Any<CancellationToken>());

        Assert.Equal(SeerrId, await Get(Series(1399)));
        await _seerr.Received(1).GetTitleSummaryAsync(Endpoint, SeerrUserId, CatalogMediaType.Tv, 1399, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task OwnTrailerThatIsNoYouTubeVideo_FallsBackToSeerr()
    {
        Assert.Equal(SeerrId, await Get(Movie(603, "https://vimeo.com/12345")));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("0")]
    [InlineData("-5")]
    public async Task WithoutATmdbId_SeerrIsNotAsked(string? tmdb)
    {
        var movie = TestData.Movie("m");
        if (tmdb is not null)
        {
            // Straight into the dictionary: SetProviderId refuses an empty id, but a hand-written NFO needn't.
            movie.ProviderIds[nameof(MetadataProvider.Tmdb)] = tmdb;
        }

        Assert.Null(await Get(movie));
        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Fact]
    public async Task OtherItemTypes_AreNotLookedUpInSeerr()
    {
        var series = TestData.Series("s");
        var episode = TestData.Episode(series, 1, 1);
        episode.SetProviderId(MetadataProvider.Tmdb, "603");

        Assert.Null(await Get(episode));
        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Fact]
    public async Task UserWithoutSeerrAccount_SeerrIsNotAsked()
    {
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        Assert.Null(await Get(Movie(603)));
        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Fact]
    public async Task SeerrsAnswer_IsCachedForADay_ForEveryone()
    {
        var other = TestData.User("bob");
        _users.GetAccessAsync(other.Id, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        Assert.Equal(SeerrId, await Get(Movie(603)));
        _time.Advance(YouTubeTrailers.HitTtl - TimeSpan.FromMinutes(1));
        Assert.Equal(SeerrId, await Get(Movie(603)));

        // Someone without a Seerr account gets the cached id too: it's no secret, and nothing is asked for them.
        Assert.Equal(SeerrId, await _trailers.GetAsync(Movie(603), other, CancellationToken.None));
        await _seerr.ReceivedWithAnyArgs(1).GetTitleSummaryAsync(default!, default, default!, default, default);

        _time.Advance(TimeSpan.FromMinutes(2));
        Assert.Equal(SeerrId, await Get(Movie(603)));
        await _seerr.ReceivedWithAnyArgs(2).GetTitleSummaryAsync(default!, default, default!, default, default);
    }

    [Fact]
    public async Task Cache_IsPerTitleAndType()
    {
        await Get(Movie(603));
        await Get(Movie(604));
        await Get(Series(603));
        await Get(Movie(603));

        await _seerr.ReceivedWithAnyArgs(3).GetTitleSummaryAsync(default!, default, default!, default, default);
    }

    [Fact]
    public async Task NoTrailerInSeerr_IsCachedForAnHour()
    {
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(Title(new SeerrVideo { Site = "YouTube", Type = "Featurette", Key = SeerrId }));

        Assert.Null(await Get(Movie(603)));
        _time.Advance(YouTubeTrailers.MissTtl - TimeSpan.FromMinutes(1));
        Assert.Null(await Get(Movie(603)));
        await _seerr.ReceivedWithAnyArgs(1).GetTitleSummaryAsync(default!, default, default!, default, default);

        _time.Advance(TimeSpan.FromMinutes(2));
        await Get(Movie(603));
        await _seerr.ReceivedWithAnyArgs(2).GetTitleSummaryAsync(default!, default, default!, default, default);
    }

    [Fact]
    public async Task TitleUnknownToSeerr_IsCachedAsNoTrailer()
    {
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ThrowsAsyncForAnyArgs(new SeerrException("404", HttpStatusCode.NotFound));

        Assert.Null(await Get(Movie(603)));
        Assert.Null(await Get(Movie(603)));
        await _seerr.ReceivedWithAnyArgs(1).GetTitleSummaryAsync(default!, default, default!, default, default);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SeerrDown_NoTrailer_CachedForFiveMinutes(bool circuitOpen)
    {
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ThrowsAsyncForAnyArgs(new SeerrException("down") { IsCircuitOpen = circuitOpen });

        Assert.Null(await Get(Movie(603)));
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(Title(Video(SeerrId)));
        _time.Advance(YouTubeTrailers.FailureTtl - TimeSpan.FromSeconds(1));
        Assert.Null(await Get(Movie(603)));
        await _seerr.ReceivedWithAnyArgs(1).GetTitleSummaryAsync(default!, default, default!, default, default);

        _time.Advance(TimeSpan.FromSeconds(2));
        Assert.Equal(SeerrId, await Get(Movie(603)));
    }

    [Fact]
    public async Task SomethingElseFailing_IsNoTrailer_AndCachedAsAFailure()
    {
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ThrowsAsyncForAnyArgs(new InvalidOperationException("bug"));

        Assert.Null(await Get(Movie(603)));
        Assert.Null(await Get(Movie(603)));
        await _seerr.ReceivedWithAnyArgs(1).GetTitleSummaryAsync(default!, default, default!, default, default);
    }

    [Fact]
    public async Task ConcurrentLookups_AskSeerrOnce_AndAllGetTheAnswer()
    {
        var seerr = new TaskCompletionSource<SeerrTitle>(TaskCreationOptions.RunContinuationsAsynchronously);
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(seerr.Task);

        var first = Get(Movie(603));
        var second = Get(Movie(603));
        var other = Get(Movie(604));
        Assert.False(first.IsCompleted);
        await _seerr.Received(1).GetTitleSummaryAsync(Endpoint, SeerrUserId, CatalogMediaType.Movie, 603, Arg.Any<CancellationToken>());
        await _seerr.Received(1).GetTitleSummaryAsync(Endpoint, SeerrUserId, CatalogMediaType.Movie, 604, Arg.Any<CancellationToken>());

        seerr.SetResult(new SeerrTitle { Id = 1, RelatedVideos = [Video(SeerrId)] });
        Assert.Equal(SeerrId, await first);
        Assert.Equal(SeerrId, await second);
        Assert.Equal(SeerrId, await other);

        // And then from the cache.
        Assert.Equal(SeerrId, await Get(Movie(603)));
        await _seerr.ReceivedWithAnyArgs(2).GetTitleSummaryAsync(default!, default, default!, default, default);
    }

    [Fact]
    public async Task ACallerThatGivesUp_DoesNotCancelTheLookupForTheOthers()
    {
        var seerr = new TaskCompletionSource<SeerrTitle>(TaskCreationOptions.RunContinuationsAsynchronously);
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(seerr.Task);
        using var cancel = new CancellationTokenSource();

        var leaving = _trailers.GetAsync(Movie(603), _user, cancel.Token);
        var staying = Get(Movie(603));
        await cancel.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => leaving);

        // Seerr isn't told to stop for the caller that left.
        await _seerr.Received(1).GetTitleSummaryAsync(Endpoint, SeerrUserId, CatalogMediaType.Movie, 603, CancellationToken.None);
        seerr.SetResult(new SeerrTitle { Id = 1, RelatedVideos = [Video(SeerrId)] });
        Assert.Equal(SeerrId, await staying);
        Assert.Equal(SeerrId, await Get(Movie(603)));
        await _seerr.ReceivedWithAnyArgs(1).GetTitleSummaryAsync(default!, default, default!, default, default);
    }

    [Fact]
    public async Task AnotherSeerr_DoesNotShareTheCache()
    {
        await Get(Movie(603));
        var moved = new SeerrEndpoint(new Uri("http://other:5055/"), "k");
        _config.Current.Returns(WithSeerr("http://other:5055"));
        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, SeerrUserId, moved));

        await Get(Movie(603));

        await _seerr.Received(1).GetTitleSummaryAsync(moved, SeerrUserId, CatalogMediaType.Movie, 603, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Cache_IsBounded()
    {
        for (var id = 1; id <= YouTubeTrailers.Capacity + 25; id++)
        {
            await Get(Movie(id));
        }

        Assert.Equal(YouTubeTrailers.Capacity, _trailers.CachedCount);

        // The newest stayed, the oldest went.
        _seerr.ClearReceivedCalls();
        await Get(Movie(YouTubeTrailers.Capacity + 25));
        Assert.Empty(_seerr.ReceivedCalls());
        await Get(Movie(1));
        await _seerr.ReceivedWithAnyArgs(1).GetTitleSummaryAsync(default!, default, default!, default, default);
    }

    [Fact]
    public void FromSeerr_PrefersATrailerOverATeaser_OnYouTubeOnly()
    {
        SeerrVideo[] videos =
        [
            new() { Site = "Vimeo", Type = "Trailer", Key = "vimeoTrail1" },
            new() { Site = "YouTube", Type = "Clip", Key = "aClipVideo1" },
            new() { Site = "YouTube", Type = "Teaser", Key = "teaserVide1" },
            new() { Site = "YouTube", Type = "Trailer", Key = "not valid!!" },
            new() { Site = "YouTube", Type = "Trailer", Key = "trailerOne1" },
            new() { Site = "YouTube", Type = "Trailer", Key = "trailerTwo2" },
        ];

        Assert.Equal("trailerOne1", YouTubeTrailers.FromSeerr(videos));
        Assert.Equal("teaserVide1", YouTubeTrailers.FromSeerr(videos.Take(4).ToList()));
        Assert.Null(YouTubeTrailers.FromSeerr(videos.Take(2).ToList()));
        Assert.Null(YouTubeTrailers.FromSeerr(null));
    }

    [Fact]
    public async Task Diagnose_TheItemsOwnTrailer_ComesFromJellyfinsMetadata_WithoutAskingSeerr()
    {
        var info = await _trailers.DiagnoseAsync(Movie(603, "https://www.youtube.com/watch?v=" + OwnId), _user, false, CancellationToken.None);

        Assert.Equal(new YouTubeDiagnosis(OwnId, TrailerSource.Jellyfin, new TrailerOutcome(TrailerStatus.Found, null, null), false), info);
        Assert.Empty(_seerr.ReceivedCalls());
    }

    [Fact]
    public async Task Diagnose_SeerrsTrailer_ComesFromSeerr_ThenFromTheCache()
    {
        var first = await _trailers.DiagnoseAsync(Movie(603), _user, false, CancellationToken.None);
        _time.Advance(TimeSpan.FromMinutes(5));
        var second = await _trailers.DiagnoseAsync(Movie(603), _user, false, CancellationToken.None);

        Assert.Equal(new YouTubeDiagnosis(SeerrId, TrailerSource.Seerr, new TrailerOutcome(TrailerStatus.Found, null, TestData.Now), false), first);
        Assert.Equal(first with { Cached = true }, second);
        await _seerr.ReceivedWithAnyArgs(1).GetTitleSummaryAsync(default!, default, default!, default, default);
    }

    [Fact]
    public async Task Diagnose_Refresh_AsksSeerrAgain()
    {
        await Get(Movie(603));
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(Title());

        var info = await _trailers.DiagnoseAsync(Movie(603), _user, true, CancellationToken.None);

        Assert.Equal(TrailerStatus.NotFound, info.Outcome.Status);
        Assert.Null(info.VideoId);
        await _seerr.ReceivedWithAnyArgs(2).GetTitleSummaryAsync(default!, default, default!, default, default);
        Assert.Null(await Get(Movie(603)));
    }

    [Fact]
    public async Task Diagnose_WithoutSeerr_OrATmdbId_OrAccess_SaysSo()
    {
        Assert.Equal(TrailerStatus.NoId, (await _trailers.DiagnoseAsync(Movie(null), _user, false, CancellationToken.None)).Outcome.Status);

        _users.GetAccessAsync(_user.Id, Arg.Any<CancellationToken>()).Returns(new RequestAccess(false, false, false, null, null));
        Assert.Equal(
            new TrailerOutcome(TrailerStatus.NoSeerr, "no Seerr access for this user", null),
            (await _trailers.DiagnoseAsync(Series(1399), _user, false, CancellationToken.None)).Outcome);

        _config.Current.Returns(new PluginConfiguration { YouTubeTrailers = true });
        Assert.Equal(
            new TrailerOutcome(TrailerStatus.NoSeerr, "Seerr isn't set up", null),
            (await _trailers.DiagnoseAsync(Movie(603), _user, false, CancellationToken.None)).Outcome);
    }

    [Fact]
    public async Task Diagnose_SeerrFailing_IsAnError_WithItsStatusOnly()
    {
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default)
            .ThrowsAsyncForAnyArgs(new SeerrException("Seerr answered with HTTP 503 at http://seerr:5055/api/v1/movie/603", HttpStatusCode.ServiceUnavailable));

        var info = await _trailers.DiagnoseAsync(Movie(603), _user, false, CancellationToken.None);

        Assert.Equal(new TrailerOutcome(TrailerStatus.Error, "Seerr answered HTTP 503", TestData.Now), info.Outcome);
    }

    [Fact]
    public async Task Diagnose_SeerrNotKnowingTheTitle_IsNotFound()
    {
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default)
            .ThrowsAsyncForAnyArgs(new SeerrException("not found", HttpStatusCode.NotFound));

        Assert.Equal(TrailerStatus.NotFound, (await _trailers.DiagnoseAsync(Movie(603), _user, false, CancellationToken.None)).Outcome.Status);
    }

    private static PluginConfiguration WithSeerr(string url = "http://seerr:5055") =>
        new() { YouTubeTrailers = true, RequestsEnabled = true, SeerrUrl = url, SeerrApiKey = "k" };

    private static SeerrVideo Video(string key, string type = "Trailer") => new() { Site = "YouTube", Type = type, Key = key };

    private static Task<SeerrTitle> Title(params SeerrVideo[] videos) => Task.FromResult(new SeerrTitle { Id = 1, RelatedVideos = videos });

    private static BaseItem Movie(int? tmdb, params string[] trailers) => WithIds(TestData.Movie("m"), tmdb, trailers);

    private static BaseItem Series(int? tmdb, params string[] trailers) => WithIds(TestData.Series("s"), tmdb, trailers);

    private static BaseItem WithIds(BaseItem item, int? tmdb, string[] trailers)
    {
        if (tmdb is { } id)
        {
            item.SetProviderId(MetadataProvider.Tmdb, id.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        item.RemoteTrailers = trailers.Select(url => new MediaUrl { Url = url, Name = "Trailer" }).ToArray();
        return item;
    }

    private Task<string?> Get(BaseItem item) => _trailers.GetAsync(item, _user, CancellationToken.None);
}
