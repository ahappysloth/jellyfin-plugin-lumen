using System.Security.Claims;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
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
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly TrailerRefreshLimiter _limiter;
    private readonly User _user = TestData.User();
    private readonly BaseItem _movie = TestData.Movie("m");

    public TrailersControllerTests()
    {
        _limiter = new TrailerRefreshLimiter(_time);
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

    [Fact]
    public async Task TrailerInfo_IsTheDiagnosis_WithWhetherThereIsALocalTrailer_AndNoRefreshForAUser()
    {
        var diagnosis = Diagnosis(null);
        _online.DiagnoseAsync(_movie, _user, false, false, Arg.Any<CancellationToken>()).Returns(diagnosis);

        var controller = Create();
        var info = (await controller.GetTrailerInfo(_movie.Id, CancellationToken.None)).Value!;

        Assert.Equal(TrailerInfoDto.From(diagnosis, false), info);
        Assert.False(info.CanRefresh);
        Assert.Equal("found", info.Imdb.Status);
        Assert.Equal(["1080p", "720p"], info.Imdb.Qualities);
        Assert.Equal(("dQw4w9WgXcQ", "jellyfin"), (info.YouTube.VideoId, info.YouTube.Source));
        Assert.Equal("no-store", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public async Task TrailerInfo_ALocalTrailer_IsPassedOn()
    {
        _trailers.GetLocalTrailerId(_movie, _user).Returns(Guid.NewGuid());
        _online.DiagnoseAsync(_movie, _user, true, false, Arg.Any<CancellationToken>()).Returns(Diagnosis(null) with { LocalTrailer = true });

        var info = (await Create().GetTrailerInfo(_movie.Id, CancellationToken.None)).Value!;

        Assert.True(info.LocalTrailer);
        Assert.Null(info.Skipped);
    }

    [Fact]
    public async Task TrailerInfo_AnAdministrator_MayCheckAgain_ButNotWhenNothingIsAsked()
    {
        MakeAdmin();
        _online.DiagnoseAsync(_movie, _user, false, false, Arg.Any<CancellationToken>()).Returns(Diagnosis(null));
        Assert.True((await Create().GetTrailerInfo(_movie.Id, CancellationToken.None)).Value!.CanRefresh);

        _online.DiagnoseAsync(_movie, _user, false, false, Arg.Any<CancellationToken>()).Returns(Diagnosis(TrailerSkip.OnlineOff));
        Assert.False((await Create().GetTrailerInfo(_movie.Id, CancellationToken.None)).Value!.CanRefresh);
    }

    [Fact]
    public async Task TrailerInfo_ForAnItemTheUserCannotSee_OrWhileLumenIsOff_IsNotFound()
    {
        Assert.IsType<NotFoundResult>((await Create().GetTrailerInfo(Guid.NewGuid(), CancellationToken.None)).Result);

        _config.Current.Returns(new PluginConfiguration { Enabled = false, YouTubeTrailers = true });
        Assert.IsType<NotFoundResult>((await Create().GetTrailerInfo(_movie.Id, CancellationToken.None)).Result);
        Assert.Empty(_online.ReceivedCalls());
    }

    [Fact]
    public async Task Refresh_IsForAdministratorsOnly_EvenWithoutThePolicy()
    {
        var result = await Create().RefreshTrailerInfo(_movie.Id, CancellationToken.None);

        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(result.Result).StatusCode);
        Assert.Empty(_online.ReceivedCalls());
        var attribute = Assert.Single(typeof(TrailersController).GetMethod(nameof(TrailersController.RefreshTrailerInfo))!.GetCustomAttributes(typeof(AuthorizeAttribute), false));
        Assert.Equal(Policies.RequiresElevation, ((AuthorizeAttribute)attribute).Policy);
    }

    [Fact]
    public async Task Refresh_AsksAgain_OncePerTitleEveryHalfMinute()
    {
        MakeAdmin();
        _online.DiagnoseAsync(_movie, _user, false, true, Arg.Any<CancellationToken>()).Returns(Diagnosis(null));

        Assert.True((await Create().RefreshTrailerInfo(_movie.Id, CancellationToken.None)).Value!.CanRefresh);

        var controller = Create();
        var limited = Assert.IsType<ObjectResult>((await controller.RefreshTrailerInfo(_movie.Id, CancellationToken.None)).Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, limited.StatusCode);
        Assert.Equal("30", controller.Response.Headers.RetryAfter.ToString());

        _time.Advance(TrailerRefreshLimiter.PerTitleGap);
        Assert.NotNull((await Create().RefreshTrailerInfo(_movie.Id, CancellationToken.None)).Value);
        await _online.Received(2).DiagnoseAsync(_movie, _user, false, true, Arg.Any<CancellationToken>());
    }

    [Fact]
    public void Limiter_AlsoCapsEachUserAcrossTitles()
    {
        var user = Guid.NewGuid();
        for (var i = 0; i < TrailerRefreshLimiter.MaxPerWindow; i++)
        {
            Assert.True(_limiter.TryAcquire(user, "t" + i, out _));
        }

        Assert.False(_limiter.TryAcquire(user, "another", out var wait));
        Assert.Equal(TrailerRefreshLimiter.Window, wait);
        Assert.True(_limiter.TryAcquire(Guid.NewGuid(), "another", out _));

        _time.Advance(TrailerRefreshLimiter.Window);
        Assert.True(_limiter.TryAcquire(user, "another", out _));
    }

    private static TrailerDiagnosis Diagnosis(string? skipped) => new(
        true,
        skipped != TrailerSkip.OnlineOff,
        false,
        skipped,
        new ImdbDiagnosis("tt0133093", new TrailerOutcome(skipped is null ? TrailerStatus.Found : TrailerStatus.Skipped, null, TestData.Now), skipped is null ? ["1080p", "720p"] : [], true),
        new YouTubeDiagnosis(skipped is null ? "dQw4w9WgXcQ" : null, skipped is null ? TrailerSource.Jellyfin : null, new TrailerOutcome(skipped is null ? TrailerStatus.Found : TrailerStatus.Skipped, null, null), false));

    private void MakeAdmin() => _user.SetPermission(PermissionKind.IsAdministrator, true);

    private TrailersController Create(bool signedIn = true) => new(_online, _trailers, _library, _users, _config, _limiter, NullLogger<TrailersController>.Instance)
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
