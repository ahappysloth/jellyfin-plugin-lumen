using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Entities;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class OnlineTrailersTests
{
    private const string Url = "https://imdb-video.media-imdb.com/vi1/a.mp4";
    private readonly IImdbTrailers _imdb = Substitute.For<IImdbTrailers>();
    private readonly IYouTubeTrailers _youTube = Substitute.For<IYouTubeTrailers>();
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly User _user = TestData.User();
    private readonly OnlineTrailers _online;

    public OnlineTrailersTests()
    {
        _config.Current.Returns(new PluginConfiguration { YouTubeTrailers = true });
        _youTube.GetAsync(default!, default!, default).ReturnsForAnyArgs("dQw4w9WgXcQ");
        _imdb.GetAsync(default, default).ReturnsForAnyArgs((ImdbTrailer?)null);
        _online = new OnlineTrailers(_imdb, _youTube, _config);
    }

    [Fact]
    public async Task IMDbsTrailer_ComesWithYouTubes_AsTheBrowsersFallback()
    {
        var movie = Movie("tt0133093");
        _imdb.GetAsync("tt0133093", Arg.Any<CancellationToken>()).Returns(new ImdbTrailer(Url, null));

        Assert.Equal(new OnlineTrailer(Url, "dQw4w9WgXcQ"), await _online.GetAsync(movie, _user, CancellationToken.None));
    }

    [Fact]
    public async Task IMDbs1080pFile_ComesWithIt()
    {
        const string Hd = "https://imdb-video.media-imdb.com/vi1/a_1080p.mp4";
        _imdb.GetAsync("tt0133093", Arg.Any<CancellationToken>()).Returns(new ImdbTrailer(Url, null, Hd));

        Assert.Equal(new OnlineTrailer(Url, "dQw4w9WgXcQ", Hd), await _online.GetAsync(Movie("tt0133093"), _user, CancellationToken.None));
        Assert.Equal(new OnlineTrailer(Url, null, Hd), await _online.GetAsync(new SeerrTitle { Id = 603, ImdbId = "tt0133093" }, CancellationToken.None));
    }

    [Fact]
    public async Task IMDbAndYouTube_AreAskedSideBySide()
    {
        var imdb = new TaskCompletionSource<ImdbTrailer?>();
        var youTube = new TaskCompletionSource<string?>();
        _imdb.GetAsync("tt0133093", Arg.Any<CancellationToken>()).Returns(imdb.Task);
        _youTube.GetAsync(default!, default!, default).ReturnsForAnyArgs(youTube.Task);

        var asking = _online.GetAsync(Movie("tt0133093"), _user, CancellationToken.None);

        // YouTube is asked before IMDb has answered.
        await _youTube.ReceivedWithAnyArgs(1).GetAsync(default!, default!, default);
        imdb.SetResult(new ImdbTrailer(Url, null));
        youTube.SetResult(null);
        Assert.Equal(new OnlineTrailer(Url, null), await asking);
    }

    [Fact]
    public async Task NoneOnIMDb_FallsBackToYouTube()
    {
        var movie = Movie("tt0133093");

        Assert.Equal(new OnlineTrailer(null, "dQw4w9WgXcQ"), await _online.GetAsync(movie, _user, CancellationToken.None));
        await _imdb.Received(1).GetAsync("tt0133093", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task WithoutAnImdbId_IMDbIsAskedForNothing_AndYouTubeAnswers()
    {
        Assert.Equal(new OnlineTrailer(null, "dQw4w9WgXcQ"), await _online.GetAsync(TestData.Movie("m"), _user, CancellationToken.None));
        await _imdb.Received(1).GetAsync(null, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task NeitherHasOne_IsNone()
    {
        _youTube.GetAsync(default!, default!, default).ReturnsForAnyArgs((string?)null);

        Assert.Equal(OnlineTrailer.None, await _online.GetAsync(Movie("tt0133093"), _user, CancellationToken.None));
    }

    [Theory]
    [InlineData(false, true, true)]
    [InlineData(true, false, true)]
    [InlineData(true, true, false)]
    public async Task Off_NothingIsAsked(bool enabled, bool previews, bool online)
    {
        _config.Current.Returns(new PluginConfiguration { Enabled = enabled, TrailerPreview = previews, YouTubeTrailers = online });

        Assert.Equal(OnlineTrailer.None, await _online.GetAsync(Movie("tt0133093"), _user, CancellationToken.None));
        Assert.Equal(OnlineTrailer.None, await _online.GetAsync(new SeerrTitle { Id = 603, ImdbId = "tt0133093" }, CancellationToken.None));
        Assert.Empty(_imdb.ReceivedCalls());
        Assert.Empty(_youTube.ReceivedCalls());
    }

    [Fact]
    public async Task ACatalogMovie_UsesSeerrsImdbId()
    {
        _imdb.GetAsync("tt0133093", Arg.Any<CancellationToken>()).Returns(new ImdbTrailer(Url, null));

        Assert.Equal(new OnlineTrailer(Url, null), await _online.GetAsync(new SeerrTitle { Id = 603, ImdbId = "tt0133093" }, CancellationToken.None));
    }

    [Fact]
    public async Task ACatalogShow_UsesItsExternalImdbId()
    {
        _imdb.GetAsync("tt0903747", Arg.Any<CancellationToken>()).Returns(new ImdbTrailer(Url, null));

        var show = new SeerrTitle { Id = 1396, ExternalIds = new SeerrExternalIds { ImdbId = "tt0903747" } };
        Assert.Equal(new OnlineTrailer(Url, null), await _online.GetAsync(show, CancellationToken.None));
    }

    [Fact]
    public async Task ACatalogTitle_OnIMDb_AlsoCarriesSeerrsYouTubeTrailer()
    {
        _imdb.GetAsync("tt0133093", Arg.Any<CancellationToken>()).Returns(new ImdbTrailer(Url, null));
        var title = new SeerrTitle { Id = 603, ImdbId = "tt0133093", RelatedVideos = [new SeerrVideo { Site = "YouTube", Type = "Trailer", Key = "trailerOne1" }] };

        Assert.Equal(new OnlineTrailer(Url, "trailerOne1"), await _online.GetAsync(title, CancellationToken.None));
    }

    [Fact]
    public async Task ACatalogTitle_WithoutOneOnIMDb_PlaysSeerrsYouTubeTrailer()
    {
        var title = new SeerrTitle
        {
            Id = 603,
            ImdbId = "tt0133093",
            RelatedVideos = [new SeerrVideo { Site = "YouTube", Type = "Clip", Key = "aClipVideo1" }, new SeerrVideo { Site = "YouTube", Type = "Trailer", Key = "trailerOne1" }],
        };

        Assert.Equal(new OnlineTrailer(null, "trailerOne1"), await _online.GetAsync(title, CancellationToken.None));
    }

    [Theory]
    [InlineData("0133093", null, null)]
    [InlineData("", "tt0903747", "tt0903747")]
    [InlineData(null, "tt0903747", "tt0903747")]
    [InlineData("tt0133093", "tt0903747", "tt0133093")]
    [InlineData(" tt0133093 ", null, "tt0133093")]
    [InlineData("tt0133093\"", "nm0000206", null)]
    public void SeerrsImdbId_IsTakenOnlyWhenItIsOne(string? imdbId, string? external, string? expected)
    {
        var title = new SeerrTitle { ImdbId = imdbId, ExternalIds = new SeerrExternalIds { ImdbId = external } };

        Assert.Equal(expected, title.ImdbTitleId);
    }

    [Fact]
    public void SeerrsAnswers_CarryTheImdbId()
    {
        var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
        var movie = System.Text.Json.JsonSerializer.Deserialize<SeerrTitle>("""{"id":603,"imdbId":"tt0133093","externalIds":{"imdbId":"tt0133093"}}""", options)!;
        var show = System.Text.Json.JsonSerializer.Deserialize<SeerrTitle>("""{"id":1396,"externalIds":{"imdbId":"tt0903747","tvdbId":81189}}""", options)!;

        Assert.Equal("tt0133093", movie.ImdbTitleId);
        Assert.Equal("tt0903747", show.ImdbTitleId);
    }

    [Theory]
    [InlineData(false, true, false, TrailerSkip.PreviewsOff)]
    [InlineData(true, false, true, TrailerSkip.OnlineOff)]
    public async Task Diagnose_SettingOff_AsksNothing_AndSaysWhy(bool previews, bool online, bool local, string skipped)
    {
        _config.Current.Returns(new PluginConfiguration { TrailerPreview = previews, YouTubeTrailers = online });

        var info = await _online.DiagnoseAsync(Movie("tt0133093"), _user, local, false, CancellationToken.None);

        Assert.Equal(skipped, info.Skipped);
        Assert.Equal((previews, online, (bool?)local), (info.Previews, info.Online, info.LocalTrailer));
        Assert.Equal("tt0133093", info.Imdb.ImdbId);
        Assert.Equal(TrailerStatus.Skipped, info.Imdb.Outcome.Status);
        Assert.Equal(TrailerStatus.Skipped, info.YouTube.Outcome.Status);
        Assert.Empty(_imdb.ReceivedCalls());
        Assert.Empty(_youTube.ReceivedCalls());
    }

    [Fact]
    public async Task Diagnose_ALocalTrailer_WinsButTheOnlineOnesAreStillLookedUp_ForWhatWouldPlayWithoutIt()
    {
        var movie = Movie("tt0133093");
        var imdb = new ImdbDiagnosis("tt0133093", new TrailerOutcome(TrailerStatus.Found, null, TestData.Now), ["720p"], false);
        var youTube = new YouTubeDiagnosis(null, null, new TrailerOutcome(TrailerStatus.NoSeerr, "Seerr isn't set up", null), false);
        _imdb.DiagnoseAsync("tt0133093", false, Arg.Any<CancellationToken>()).Returns(imdb);
        _youTube.DiagnoseAsync(movie, _user, false, Arg.Any<CancellationToken>()).Returns(youTube);

        Assert.Equal(new TrailerDiagnosis(true, true, true, null, imdb, youTube), await _online.DiagnoseAsync(movie, _user, true, false, CancellationToken.None));
    }

    [Fact]
    public async Task Diagnose_AsksBothSources_PassingRefreshOn()
    {
        var movie = Movie("tt0133093");
        var imdb = new ImdbDiagnosis("tt0133093", new TrailerOutcome(TrailerStatus.Timeout, "no answer within 4 s", TestData.Now), [], false);
        var youTube = new YouTubeDiagnosis("dQw4w9WgXcQ", TrailerSource.Seerr, new TrailerOutcome(TrailerStatus.Found, null, TestData.Now), true);
        _imdb.DiagnoseAsync("tt0133093", true, Arg.Any<CancellationToken>()).Returns(imdb);
        _youTube.DiagnoseAsync(movie, _user, true, Arg.Any<CancellationToken>()).Returns(youTube);

        var info = await _online.DiagnoseAsync(movie, _user, false, true, CancellationToken.None);

        Assert.Equal(new TrailerDiagnosis(true, true, false, null, imdb, youTube), info);
    }

    [Fact]
    public async Task Diagnose_ACatalogTitle_TakesItsYouTubeTrailerFromSeerr_AndHasNoLocalTrailer()
    {
        var imdb = new ImdbDiagnosis("tt0133093", new TrailerOutcome(TrailerStatus.NotFound, null, TestData.Now), [], true);
        _imdb.DiagnoseAsync("tt0133093", false, Arg.Any<CancellationToken>()).Returns(imdb);
        var title = new SeerrTitle { Id = 603, ImdbId = "tt0133093", RelatedVideos = [new SeerrVideo { Site = "YouTube", Type = "Trailer", Key = "dQw4w9WgXcQ" }] };

        var info = await _online.DiagnoseAsync(title, false, CancellationToken.None);

        Assert.Null(info.LocalTrailer);
        Assert.Equal(imdb, info.Imdb);
        Assert.Equal(new YouTubeDiagnosis("dQw4w9WgXcQ", TrailerSource.Seerr, new TrailerOutcome(TrailerStatus.Found, null, null), false), info.YouTube);

        var none = await _online.DiagnoseAsync(new SeerrTitle { Id = 604 }, false, CancellationToken.None);
        Assert.Equal(TrailerStatus.NotFound, none.YouTube.Outcome.Status);
    }

    private static MediaBrowser.Controller.Entities.Movies.Movie Movie(string imdb)
    {
        var movie = TestData.Movie("m");
        movie.SetProviderId(MetadataProvider.Imdb, imdb);
        return movie;
    }
}
