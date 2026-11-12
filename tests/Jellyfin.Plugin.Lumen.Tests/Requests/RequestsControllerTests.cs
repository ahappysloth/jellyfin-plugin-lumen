using System.Net;
using System.Security.Claims;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public sealed class RequestsControllerTests : IDisposable
{
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/"), "key123");

    private readonly ISeerrUserMap _users = Substitute.For<ISeerrUserMap>();
    private readonly ITmdbImageCache _images = Substitute.For<ITmdbImageCache>();
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly IUserManager _userManager = Substitute.For<IUserManager>();
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly IRequestProgressService _progress = Substitute.For<IRequestProgressService>();
    private readonly IReadyAnnouncements _announcements = Substitute.For<IReadyAnnouncements>();
    private readonly HomeCache _home = new(Substitute.For<IUserDataManager>(), Substitute.For<ILibraryManager>(), TimeProvider.System);
    private readonly Jellyfin.Database.Implementations.Entities.User _jellyfinUser = TestData.User();
    private readonly Guid _user;

    public RequestsControllerTests()
    {
        _user = _jellyfinUser.Id;
        _userManager.GetUserById(_user).Returns(_jellyfinUser);
    }

    public void Dispose() => _home.Dispose();

    [Fact]
    public async Task Status_RequiresAJellyfinUser()
    {
        Assert.IsType<UnauthorizedResult>((await Create(signedIn: false).GetStatus(CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Status_ReportsTheUsersAccess_WithoutTheirSeerrId()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, false, 9, Endpoint));

        var status = (await Create().GetStatus(CancellationToken.None)).Value;

        Assert.Equal(new RequestStatusDto(true, true, false, CatalogImageToken.Create(_user, "key123")), status);
    }

    [Fact]
    public async Task Status_GivesNoImageToken_WithoutCatalogAccess()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        Assert.Null((await Create().GetStatus(CancellationToken.None)).Value!.ImageToken);
    }

    [Fact]
    public async Task Image_FromAnImgTag_IsAuthorizedByTheImageToken_NotTheAccessToken()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, false, false, 1, Endpoint));
        var path = Path.GetTempFileName();
        File.WriteAllBytes(path, [1, 2, 3]);
        _images.GetAsync("w780", "abc.jpg", Arg.Any<CancellationToken>()).Returns(new CachedImage(path, "image/jpeg"));

        var file = Assert.IsType<FileStreamResult>(
            await Create(signedIn: false).GetImage("w780", "abc.jpg", CancellationToken.None, CatalogImageToken.Create(_user, "key123")));
        await file.FileStream.DisposeAsync();
        File.Delete(path);
    }

    [Theory]
    [InlineData("other-key")]
    [InlineData(null)]
    public async Task Image_RejectsAForgedOrStaleImageToken(string? signedWith)
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, false, false, 1, Endpoint));
        var token = signedWith is null ? _user.ToString("N") + ".AAAAAAAAAAAAAAAAAAAAAA" : CatalogImageToken.Create(_user, signedWith);

        Assert.IsType<NotFoundResult>(await Create(signedIn: false).GetImage("w780", "abc.jpg", CancellationToken.None, token));
        await _images.DidNotReceiveWithAnyArgs().GetAsync(default!, default!, default);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-token")]
    public async Task Image_WithoutAUserOrToken_IsUnauthorized(string? token)
    {
        Assert.IsType<UnauthorizedResult>(await Create(signedIn: false).GetImage("w780", "abc.jpg", CancellationToken.None, token));
        await _users.DidNotReceiveWithAnyArgs().GetAccessAsync(default, default);
    }

    [Fact]
    public async Task Image_RejectsDisallowedPaths_BeforeAnyLookup()
    {
        Assert.IsType<BadRequestResult>(await Create().GetImage("w780", "..%2Fx.jpg", CancellationToken.None));
        await _users.DidNotReceiveWithAnyArgs().GetAccessAsync(default, default);
    }

    [Fact]
    public async Task Image_IsHiddenFromUsersWithoutCatalogAccess()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        Assert.IsType<NotFoundResult>(await Create().GetImage("w780", "abc.jpg", CancellationToken.None));
        await _images.DidNotReceiveWithAnyArgs().GetAsync(default!, default!, default);
    }

    [Fact]
    public async Task Image_ServesTheCachedFile_WithLongCaching()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, false, false, 1, Endpoint));
        var path = Path.GetTempFileName();
        File.WriteAllBytes(path, [1, 2, 3]);
        _images.GetAsync("w780", "abc.jpg", Arg.Any<CancellationToken>()).Returns(new CachedImage(path, "image/jpeg"));
        var controller = Create();

        var file = Assert.IsType<FileStreamResult>(await controller.GetImage("w780", "abc.jpg", CancellationToken.None));

        await using (file.FileStream)
        {
            Assert.Equal("image/jpeg", file.ContentType);
            Assert.Equal(3, file.FileStream.Length);
            Assert.Contains("max-age=604800", controller.Response.Headers.CacheControl.ToString(), StringComparison.Ordinal);

            // Open, it can still be trimmed (or replaced) without breaking the response.
            File.Delete(path);
            Assert.Equal(1, file.FileStream.ReadByte());
        }
    }

    [Theory]
    [InlineData(null, 1)]
    [InlineData("", 1)]
    [InlineData("   ", 1)]
    [InlineData("matrix", 0)]
    [InlineData("matrix", 51)]
    public async Task Search_RejectsInvalidInput(string? query, int page)
    {
        GrantAccess();

        AssertError<BadRequestObjectResult>((await Create().Search(query, page)).Result);
        await _users.DidNotReceiveWithAnyArgs().GetAccessAsync(default, default);
    }

    [Fact]
    public async Task Search_RejectsLongQueries()
    {
        GrantAccess();
        _seerr.SearchAsync(default!, default, default!, default, default).ReturnsForAnyArgs(new SeerrPage());

        AssertError<BadRequestObjectResult>((await Create().Search(new string('a', 101))).Result);
        Assert.NotNull((await Create().Search(new string('a', 100))).Value);
    }

    [Fact]
    public async Task Search_IsHiddenWithoutCatalogAccess()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(false, false, false, null));

        Assert.IsType<NotFoundResult>((await Create().Search("matrix")).Result);
        await _seerr.DidNotReceiveWithAnyArgs().SearchAsync(default!, default, default!, default, default);
    }

    [Fact]
    public async Task Search_IsHiddenWithoutASeerrUserId()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, null));

        Assert.IsType<NotFoundResult>((await Create().Search("matrix")).Result);
    }

    [Fact]
    public async Task Search_RequiresAJellyfinUser()
    {
        Assert.IsType<UnauthorizedResult>((await Create(signedIn: false).Search("matrix")).Result);
    }

    [Fact]
    public async Task Search_ActsAsTheUsersSeerrAccount_AndMapsResults()
    {
        GrantAccess();
        var owned = Guid.NewGuid();
        _library.GetItemById<BaseItem>(owned, _jellyfinUser).Returns(TestData.Movie("Owned"));
        _seerr.SearchAsync(Arg.Any<SeerrEndpoint>(), 9, "the matrix", 2, Arg.Any<CancellationToken>()).Returns(new SeerrPage
        {
            Page = 2,
            TotalPages = 80,
            Results =
            [
                new SeerrMedia { MediaType = "movie", Id = 603, Title = "The Matrix", MediaInfo = new SeerrMediaInfo { Status = 5, JellyfinMediaId = owned.ToString() } },
                new SeerrMedia { MediaType = "person", Id = 1, Name = "Someone" },
            ],
        });

        var result = (await Create().Search("  the matrix ", 2)).Value!;

        var item = Assert.Single(result.Results);
        Assert.Equal(("movie-603", "Available", owned.ToString("N")), (item.Key, item.State, item.JellyfinItemId));
        Assert.Equal((2, 50), (result.Page, result.TotalPages));
        await _seerr.Received(1).SearchAsync(
            Arg.Is<SeerrEndpoint>(e => e.BaseUrl == new Uri("http://seerr:5055/") && e.ApiKey == "key123"), 9, "the matrix", 2, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Search_SeerrFailure_Is502()
    {
        GrantAccess();
        _seerr.SearchAsync(default!, default, default!, default, default).ReturnsForAnyArgs<SeerrPage>(_ => throw new SeerrException("Seerr did not answer within 5 seconds."));

        var result = Assert.IsType<ObjectResult>((await Create().Search("matrix")).Result);

        Assert.Equal(StatusCodes.Status502BadGateway, result.StatusCode);
        Assert.Equal(new ErrorDto("Seerr is unavailable."), result.Value);
    }

    [Theory]
    [InlineData("person", 1)]
    [InlineData("Movie", 1)]
    [InlineData("movie", 0)]
    [InlineData("tv", -5)]
    public async Task Title_RejectsInvalidInput(string mediaType, int tmdbId)
    {
        GrantAccess();

        AssertError<BadRequestObjectResult>((await Create().GetTitle(mediaType, tmdbId, CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Title_IsHiddenWithoutCatalogAccess()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        Assert.IsType<NotFoundResult>((await Create().GetTitle("movie", 603, CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Title_Tv_MapsDetailsAndRecommendations()
    {
        GrantAccess();
        _seerr.GetTvAsync(Arg.Any<SeerrEndpoint>(), 9, 1399, Arg.Any<CancellationToken>()).Returns(new SeerrTitle
        {
            Id = 1399,
            Name = "Lumen Saga",
            Seasons = [new() { SeasonNumber = 0 }, new() { SeasonNumber = 1, Name = "S1", EpisodeCount = 10 }, new() { SeasonNumber = 2, Name = "S2", EpisodeCount = 8 }],
            MediaInfo = new SeerrMediaInfo { Status = 4, Seasons = [new() { SeasonNumber = 1, Status = 5 }] },
        });
        _seerr.GetRecommendationsAsync(Arg.Any<SeerrEndpoint>(), 9, "tv", 1399, Arg.Any<CancellationToken>())
            .Returns(new SeerrPage { Results = [new SeerrMedia { MediaType = "tv", Id = 1, Name = "Other" }] });

        var title = (await Create().GetTitle("tv", 1399, CancellationToken.None)).Value!;

        Assert.Equal(("tv-1399", "Lumen Saga", "PartlyAvailable", true), (title.Key, title.Title, title.State, title.CanRequest));
        Assert.Equal([new CatalogSeasonDto(1, "S1", 10, "Available"), new CatalogSeasonDto(2, "S2", 8, "None")], title.Seasons);
        Assert.Equal("tv-1", Assert.Single(title.Recommendations).Key);
        await _seerr.DidNotReceiveWithAnyArgs().GetMovieAsync(default!, default, default, default);
    }

    [Fact]
    public async Task Title_RecommendationsFailing_StillReturnsTheTitle()
    {
        GrantAccess();
        _seerr.GetMovieAsync(Arg.Any<SeerrEndpoint>(), 9, 603, Arg.Any<CancellationToken>()).Returns(new SeerrTitle { Id = 603, Title = "The Matrix" });
        _seerr.GetRecommendationsAsync(default!, default, default!, default, default).ReturnsForAnyArgs<SeerrPage>(_ => throw new SeerrException("boom", HttpStatusCode.InternalServerError));

        var title = (await Create().GetTitle("movie", 603, CancellationToken.None)).Value!;

        Assert.Equal("The Matrix", title.Title);
        Assert.Empty(title.Recommendations);
    }

    [Fact]
    public async Task Title_SeerrNotFound_Is404_OtherFailures502()
    {
        GrantAccess();
        _seerr.GetRecommendationsAsync(default!, default, default!, default, default).ReturnsForAnyArgs(new SeerrPage());
        _seerr.GetMovieAsync(Arg.Any<SeerrEndpoint>(), 9, 1, Arg.Any<CancellationToken>()).Returns<SeerrTitle>(_ => throw new SeerrException("nf", HttpStatusCode.NotFound));
        _seerr.GetMovieAsync(Arg.Any<SeerrEndpoint>(), 9, 2, Arg.Any<CancellationToken>()).Returns<SeerrTitle>(_ => throw new SeerrException("down", HttpStatusCode.ServiceUnavailable));

        AssertError<NotFoundObjectResult>((await Create().GetTitle("movie", 1, CancellationToken.None)).Result);
        var failed = Assert.IsType<ObjectResult>((await Create().GetTitle("movie", 2, CancellationToken.None)).Result);
        Assert.Equal(StatusCodes.Status502BadGateway, failed.StatusCode);
    }

    [Theory]
    [InlineData("person", 1, null)]
    [InlineData(null, 1, null)]
    [InlineData("movie", 0, null)]
    [InlineData("tv", 1, new[] { 0 })]
    [InlineData("tv", 1, new[] { 1, 1001 })]
    [InlineData("tv", 1, new[] { -1 })]
    public async Task Request_RejectsInvalidInput(string? mediaType, int tmdbId, int[]? seasons)
    {
        GrantAccess();

        AssertError<BadRequestObjectResult>((await Create().CreateRequest(new CatalogRequestDto(mediaType, tmdbId, seasons), CancellationToken.None)).Result);
        AssertError<BadRequestObjectResult>((await Create().CreateRequest(null, CancellationToken.None)).Result);
        await _seerr.DidNotReceiveWithAnyArgs().CreateRequestAsync(default!, default, default!, default, default, default);
    }

    [Fact]
    public async Task Request_IsHiddenWithoutCatalogAccess()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        Assert.IsType<NotFoundResult>((await Create().CreateRequest(new CatalogRequestDto("movie", 603, null), CancellationToken.None)).Result);
    }

    [Theory]
    [InlineData("movie", false, true)]
    [InlineData("tv", true, false)]
    public async Task Request_WithoutPermissionForTheMediaType_Is403(string mediaType, bool movies, bool tv)
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, movies, tv, 9, Endpoint));

        var result = Assert.IsType<ObjectResult>((await Create().CreateRequest(new CatalogRequestDto(mediaType, 603, null), CancellationToken.None)).Result);

        Assert.Equal(StatusCodes.Status403Forbidden, result.StatusCode);
        Assert.IsType<ErrorDto>(result.Value);
        await _seerr.DidNotReceiveWithAnyArgs().CreateRequestAsync(default!, default, default!, default, default, default);
    }

    [Fact]
    public async Task Request_Tv_DeduplicatesSeasons_AndReportsApproval()
    {
        GrantAccess();
        _seerr.CreateRequestAsync(default!, default, default!, default, default, default).ReturnsForAnyArgs(new SeerrRequestResult(5, 1, 2));

        var result = (await Create().CreateRequest(new CatalogRequestDto("tv", 1399, [3, 2, 3]), CancellationToken.None)).Value;

        Assert.Equal(new RequestResultDto("Requested", true), result);
        await _seerr.Received(1).CreateRequestAsync(
            Arg.Any<SeerrEndpoint>(), 9, "tv", 1399, Arg.Is<IReadOnlyList<int>?>(s => s != null && s.Count == 2 && s[0] == 2 && s[1] == 3), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Request_Movie_IgnoresSeasons_AndMapsMediaStatus()
    {
        GrantAccess();
        _seerr.CreateRequestAsync(default!, default, default!, default, default, default).ReturnsForAnyArgs(new SeerrRequestResult(5, 2, 3));

        var result = (await Create().CreateRequest(new CatalogRequestDto("movie", 603, [1]), CancellationToken.None)).Value;

        Assert.Equal(new RequestResultDto("Downloading", false), result);
        await _seerr.Received(1).CreateRequestAsync(Arg.Any<SeerrEndpoint>(), 9, "movie", 603, null, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Request_WithoutMediaStatus_DefaultsToRequested()
    {
        GrantAccess();
        _seerr.CreateRequestAsync(default!, default, default!, default, default, default).ReturnsForAnyArgs(new SeerrRequestResult(5, 2, null));

        Assert.Equal(new RequestResultDto("Requested", false), (await Create().CreateRequest(new CatalogRequestDto("movie", 603, null), CancellationToken.None)).Value);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, "Quota exceeded.", 403, "Quota exceeded.")]
    [InlineData(HttpStatusCode.Conflict, "Request for this media already exists.", 409, "Request for this media already exists.")]
    [InlineData(HttpStatusCode.Accepted, "No seasons available to request", 409, "No seasons available to request")]
    [InlineData(HttpStatusCode.Conflict, null, 409, "This has already been requested.")]
    [InlineData(HttpStatusCode.InternalServerError, "secret internals", 502, "Seerr is unavailable.")]
    [InlineData(null, null, 502, "Seerr is unavailable.")]
    public async Task Request_SeerrErrors_AreMapped(HttpStatusCode? seerrStatus, string? seerrMessage, int expectedStatus, string expectedError)
    {
        GrantAccess();
        _seerr.CreateRequestAsync(default!, default, default!, default, default, default)
            .ReturnsForAnyArgs<SeerrRequestResult>(_ => throw new SeerrException("failed", seerrStatus, null, seerrMessage));

        var result = Assert.IsAssignableFrom<ObjectResult>((await Create().CreateRequest(new CatalogRequestDto("movie", 603, null), CancellationToken.None)).Result);

        Assert.Equal(expectedStatus, result.StatusCode);
        Assert.Equal(new ErrorDto(expectedError), result.Value);
    }

    [Fact]
    public async Task Image_IsA502_WhenTmdbFails()
    {
        GrantAccess();
        _images.GetAsync("w780", "abc.jpg", Arg.Any<CancellationToken>()).Returns(Task.FromException<CachedImage?>(new HttpRequestException("tmdb down")));

        Assert.Equal(StatusCodes.Status502BadGateway, Assert.IsType<StatusCodeResult>(await Create().GetImage("w780", "abc.jpg", CancellationToken.None)).StatusCode);
    }

    [Fact]
    public async Task Image_IsA404_WhenTmdbHasNoSuchImage()
    {
        GrantAccess();
        _images.GetAsync("w780", "abc.jpg", Arg.Any<CancellationToken>()).Returns((CachedImage?)null);

        Assert.IsType<NotFoundResult>(await Create().GetImage("w780", "abc.jpg", CancellationToken.None));
    }

    [Fact]
    public async Task Image_FetchesAgain_WhenTheFileVanishedBeforeItWasServed()
    {
        GrantAccess();
        var gone = Path.Combine(Path.GetTempPath(), "lumen-gone-" + Guid.NewGuid().ToString("N") + ".jpg");
        var path = Path.GetTempFileName();
        File.WriteAllBytes(path, [1]);
        _images.GetAsync("w780", "abc.jpg", Arg.Any<CancellationToken>()).Returns(new CachedImage(gone, "image/jpeg"), new CachedImage(path, "image/jpeg"));

        var file = Assert.IsType<FileStreamResult>(await Create().GetImage("w780", "abc.jpg", CancellationToken.None));

        await file.FileStream.DisposeAsync();
        File.Delete(path);
        await _images.Received(2).GetAsync("w780", "abc.jpg", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Image_IsA502_WhenTheFileKeepsVanishing()
    {
        GrantAccess();
        var gone = Path.Combine(Path.GetTempPath(), "lumen-gone-" + Guid.NewGuid().ToString("N") + ".jpg");
        _images.GetAsync("w780", "abc.jpg", Arg.Any<CancellationToken>()).Returns(new CachedImage(gone, "image/jpeg"));

        Assert.Equal(StatusCodes.Status502BadGateway, Assert.IsType<StatusCodeResult>(await Create().GetImage("w780", "abc.jpg", CancellationToken.None)).StatusCode);
    }

    [Fact]
    public async Task Request_RefreshesTheUsersHome()
    {
        GrantAccess();
        _seerr.CreateRequestAsync(default!, default, default!, default, default, default).ReturnsForAnyArgs(new SeerrRequestResult(5, 1, 2));
        var before = _home.Stamp(_user);

        Assert.NotNull((await Create().CreateRequest(new CatalogRequestDto("movie", 603, null), CancellationToken.None)).Value);

        Assert.NotEqual(before, _home.Stamp(_user));
    }

    [Fact]
    public async Task AFailedRequest_LeavesTheHomeCacheAlone()
    {
        GrantAccess();
        _seerr.CreateRequestAsync(default!, default, default!, default, default, default)
            .ReturnsForAnyArgs<SeerrRequestResult>(_ => throw new SeerrException("failed", HttpStatusCode.Conflict));
        var before = _home.Stamp(_user);

        await Create().CreateRequest(new CatalogRequestDto("movie", 603, null), CancellationToken.None);

        Assert.Equal(before, _home.Stamp(_user));
    }

    [Fact]
    public async Task Mine_IsNotFound_WithoutCatalogAccess()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        Assert.IsType<NotFoundResult>((await Create().GetMine(CancellationToken.None)).Result);
        await _progress.DidNotReceiveWithAnyArgs().GetAsync(default, default, default!, default, default);
    }

    [Fact]
    public async Task Mine_IsTheSignedInUsersOwn()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, 9, Endpoint));
        var mine = new MyRequestsDto([]);
        _progress.GetAsync(_user, _jellyfinUser, Endpoint, 9, Arg.Any<CancellationToken>()).Returns(mine);

        Assert.Same(mine, (await Create().GetMine(CancellationToken.None)).Value);
    }

    [Fact]
    public async Task Mine_IsABadGateway_WhenSeerrFails()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, 9, Endpoint));
        _progress.GetAsync(default, default, default!, default, default).ThrowsAsyncForAnyArgs(new SeerrException("down"));

        Assert.Equal(StatusCodes.Status502BadGateway, Assert.IsType<ObjectResult>((await Create().GetMine(CancellationToken.None)).Result).StatusCode);
    }

    [Fact]
    public async Task Announced_MarksTheSignedInUsersOwnList()
    {
        GrantAccess();

        Assert.IsType<NoContentResult>(await Create().MarkAnnounced(new AnnouncedDto([4, 5]), CancellationToken.None));
        _announcements.Received(1).MarkAnnounced(_user, "http://seerr:5055/", Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new List<int> { 4, 5 })));
    }

    [Fact]
    public async Task Announced_ValidatesTheIds()
    {
        GrantAccess();

        Assert.IsType<BadRequestObjectResult>(await Create().MarkAnnounced(new AnnouncedDto([]), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await Create().MarkAnnounced(new AnnouncedDto([0]), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await Create().MarkAnnounced(new AnnouncedDto(null), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await Create().MarkAnnounced(null, CancellationToken.None));
        _announcements.DidNotReceiveWithAnyArgs().MarkAnnounced(default, default!, default!);
    }

    [Fact]
    public async Task ANewRequest_IsWatchedForItsPopUp_AndShowsOnTheNextCheck()
    {
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, 9, Endpoint));
        _seerr.CreateRequestAsync(Endpoint, 9, "movie", 603, null, Arg.Any<CancellationToken>()).Returns(new SeerrRequestResult(12, 2, 3));

        await Create().CreateRequest(new CatalogRequestDto("movie", 603, null), CancellationToken.None);

        _progress.Received(1).Invalidate(Endpoint, 9);
        _announcements.Received(1).Update(_user, "http://seerr:5055/", Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new List<int> { 12 })), Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>());
    }

    private static void AssertError<T>(ActionResult? result)
        where T : ObjectResult =>
        Assert.IsType<ErrorDto>(Assert.IsType<T>(result).Value);

    private void GrantAccess() =>
        _users.GetAccessAsync(_user, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, 9, Endpoint));

    private RequestsController Create(bool signedIn = true) => new(_users, _images, _seerr, _home, _userManager, new CatalogMapper(_library), _progress, _announcements, NullLogger<RequestsController>.Instance)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(signedIn ? [new Claim("Jellyfin-UserId", _user.ToString("N"))] : [], "test")),
            },
        },
    };
}
