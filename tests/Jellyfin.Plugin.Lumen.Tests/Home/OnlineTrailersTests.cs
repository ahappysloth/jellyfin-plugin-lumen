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
        _imdb.GetAsync(default, default).ReturnsForAnyArgs((string?)null);
        _online = new OnlineTrailers(_imdb, _youTube, _config);
    }

    [Fact]
    public async Task IMDbsTrailer_WinsOverYouTubes_WhichIsntLookedUp()
    {
        var movie = Movie("tt0133093");
        _imdb.GetAsync("tt0133093", Arg.Any<CancellationToken>()).Returns(Url);

        Assert.Equal(new OnlineTrailer(Url, null), await _online.GetAsync(movie, _user, CancellationToken.None));
        Assert.Empty(_youTube.ReceivedCalls());
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
        _imdb.GetAsync("tt0133093", Arg.Any<CancellationToken>()).Returns(Url);

        Assert.Equal(new OnlineTrailer(Url, null), await _online.GetAsync(new SeerrTitle { Id = 603, ImdbId = "tt0133093" }, CancellationToken.None));
    }

    [Fact]
    public async Task ACatalogShow_UsesItsExternalImdbId()
    {
        _imdb.GetAsync("tt0903747", Arg.Any<CancellationToken>()).Returns(Url);

        var show = new SeerrTitle { Id = 1396, ExternalIds = new SeerrExternalIds { ImdbId = "tt0903747" } };
        Assert.Equal(new OnlineTrailer(Url, null), await _online.GetAsync(show, CancellationToken.None));
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

    private static MediaBrowser.Controller.Entities.Movies.Movie Movie(string imdb)
    {
        var movie = TestData.Movie("m");
        movie.SetProviderId(MetadataProvider.Imdb, imdb);
        return movie;
    }
}
