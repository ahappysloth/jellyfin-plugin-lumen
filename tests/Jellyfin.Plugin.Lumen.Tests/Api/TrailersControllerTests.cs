using System.Security.Claims;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class TrailersControllerTests
{
    private readonly IOnlineTrailers _online = Substitute.For<IOnlineTrailers>();
    private readonly ITrailerLookup _trailers = Substitute.For<ITrailerLookup>();
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly IUserManager _users = Substitute.For<IUserManager>();
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly User _user = TestData.User();
    private readonly BaseItem _movie = TestData.Movie("m");

    public TrailersControllerTests()
    {
        _config.Current.Returns(new PluginConfiguration { YouTubeTrailers = true });
        _users.GetUserById(_user.Id).Returns(_user);
        _library.GetItemById<BaseItem>(_movie.Id, _user).Returns(_movie);
        _online.GetAsync(_movie, _user, Arg.Any<CancellationToken>()).Returns(new OnlineTrailer(null, "dQw4w9WgXcQ"));
    }

    [Fact]
    public async Task UnknownUser_IsUnauthorized()
    {
        var result = await Create(signedIn: false).GetTrailer(_movie.Id, CancellationToken.None);

        Assert.IsType<UnauthorizedResult>(result.Result);
    }

    [Fact]
    public async Task ReturnsTheItemsYouTubeTrailer()
    {
        var result = await Create().GetTrailer(_movie.Id, CancellationToken.None);

        Assert.Equal("dQw4w9WgXcQ", result.Value!.YouTubeId);
    }

    [Fact]
    public async Task ReturnsTheItemsImdbTrailer_ItsHdFile_AndYouTubesAsTheFallback()
    {
        const string Url = "https://imdb-video.media-imdb.com/vi1/v_720p.mp4";
        const string Hd = "https://imdb-video.media-imdb.com/vi1/v_1080p.mp4";
        _online.GetAsync(_movie, _user, Arg.Any<CancellationToken>()).Returns(new OnlineTrailer(Url, "dQw4w9WgXcQ", Hd));

        var result = await Create().GetTrailer(_movie.Id, CancellationToken.None);

        // YouTube's id comes too: the page plays it should IMDb's file not play in the browser (0.6.0 dropped it).
        Assert.Equal(new OnlineTrailerDto(Url, "dQw4w9WgXcQ", Hd), result.Value);
    }

    [Fact]
    public async Task ItemTheUserCannotSee_IsNotFound()
    {
        var result = await Create().GetTrailer(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundResult>(result.Result);
        Assert.Empty(_online.ReceivedCalls());
    }

    [Fact]
    public async Task IsNotFound_WhileLumenIsSwitchedOff()
    {
        _config.Current.Returns(new PluginConfiguration { Enabled = false, YouTubeTrailers = true });

        var result = await Create().GetTrailer(_movie.Id, CancellationToken.None);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task SettingOrPreviewsOff_NoTrailer_AndNothingLookedUp(bool youTube, bool previews)
    {
        _config.Current.Returns(new PluginConfiguration { YouTubeTrailers = youTube, TrailerPreview = previews });

        var result = await Create().GetTrailer(_movie.Id, CancellationToken.None);

        Assert.Equal(new OnlineTrailerDto(null, null), result.Value);
        Assert.Empty(_online.ReceivedCalls());
    }

    [Fact]
    public async Task LocalTrailer_Wins()
    {
        _trailers.GetLocalTrailerId(_movie, _user).Returns(Guid.NewGuid());

        var result = await Create().GetTrailer(_movie.Id, CancellationToken.None);

        Assert.Equal(new OnlineTrailerDto(null, null), result.Value);
        Assert.Empty(_online.ReceivedCalls());
    }

    private TrailersController Create(bool signedIn = true) => new(_online, _trailers, _library, _users, _config, NullLogger<TrailersController>.Instance)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(signedIn ? [new Claim("Jellyfin-UserId", _user.Id.ToString("N"))] : [], "test")),
            },
        },
    };
}
