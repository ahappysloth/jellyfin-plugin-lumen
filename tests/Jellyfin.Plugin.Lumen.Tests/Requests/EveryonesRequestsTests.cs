using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;
using static Jellyfin.Plugin.Lumen.Tests.Requests.RequestProgressTests;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public sealed class EveryonesRequestsTests
{
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/"), "k");
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly ISeerrUserMap _users = Substitute.For<ISeerrUserMap>();
    private readonly IUserManager _userManager = Substitute.For<IUserManager>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly PluginConfiguration _configuration = new() { ConfigVersion = 3 };
    private readonly EveryonesRequests _service;

    public EveryonesRequestsTests()
    {
        _config.Current.Returns(_configuration);
        _service = new EveryonesRequests(_seerr, _config, new CatalogMapper(Substitute.For<ILibraryManager>()), _users, _userManager, _time);
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(
            call => new SeerrTitle { Id = call.ArgAt<int>(3), Title = "Title " + call.ArgAt<int>(3) });
    }

    [Fact]
    public async Task ListsEveryonesTitles_NewestFirst_OnePerTitleAndRequester_WithTheirProgress()
    {
        // Request ids count down in time here (RequestProgressTests.Request): 1 is the newest.
        Seerr(
            By(Request(SeerrRequestStatus.Pending, id: 4, tmdbId: 601), 7),
            By(Request(downloads: [Download(1000, 600, "downloading", TestData.Now.AddMinutes(2))], id: 3, tmdbId: 602), 8),
            By(Request(SeerrRequestStatus.Declined, id: 2, tmdbId: 602), 7),
            By(Request(SeerrRequestStatus.Pending, id: 1, tmdbId: 602), 8));

        var all = await Get();

        Assert.False(all.Partial);

        // 602 twice: user 8's and user 7's. User 8's two requests for it are one entry, as new as the newer of them,
        // showing the one under way.
        Assert.Equal(
            [("movie-602", 8, RequestProgressState.Downloading), ("movie-602", 7, RequestProgressState.Declined), ("movie-601", 7, RequestProgressState.Requested)],
            all.Requests.Select(r => (r.Item.Key, Seerr: SeerrIdOf(r), r.Status)));
        var downloading = all.Requests[0];
        Assert.Equal((40d, 120), (downloading.Percent!.Value, downloading.SecondsLeft!.Value));
        Assert.Equal([3, 1], downloading.RequestIds);
        Assert.Equal(TestData.Now.AddDays(-3), downloading.RequestedAt);
        Assert.Equal("Title 602", downloading.Item.Title);

        // Never announced: other users' titles aren't the viewer's pop-up.
        Assert.All(all.Requests, r => Assert.False(r.Announce));
    }

    [Fact]
    public async Task AsksSeerrOnceForEveryAdministrator_AndCachesItBriefly()
    {
        Seerr(By(Request(id: 1, tmdbId: 601), 7));

        await Get();
        _time.Advance(TimeSpan.FromSeconds(5));
        await Get(viewerSeerrUserId: 2);
        await _seerr.Received(1).GetAllRequestsAsync(Endpoint, EveryonesRequests.Take, Arg.Any<CancellationToken>());

        _time.Advance(RequestProgressService.Ttl);
        await Get();
        await _seerr.Received(2).GetAllRequestsAsync(Endpoint, EveryonesRequests.Take, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task TitlesAreDescribed_AsTheViewerSeesThem()
    {
        Seerr(By(Request(id: 1, tmdbId: 601), 7));

        await Get(viewerSeerrUserId: 2);

        // In the viewer's language (their Seerr account), not the requester's.
        await _seerr.Received(1).GetTitleSummaryAsync(Endpoint, 2, "movie", 601, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ARemovedTitle_IsLeftOut()
    {
        Seerr(By(Request(SeerrRequestStatus.Completed, mediaStatus: 7, id: 1, tmdbId: 601), 7), By(Request(id: 2, tmdbId: 602), 7));

        Assert.Equal(["movie-602"], (await Get()).Requests.Select(r => r.Item.Key));
    }

    [Fact]
    public async Task ATitleSeerrCantDescribe_IsLeftOut_WithoutSayingPartial()
    {
        // Asking again wouldn't help: it would be left out every time.
        _seerr.GetTitleSummaryAsync(Endpoint, Arg.Any<int>(), "movie", 601, Arg.Any<CancellationToken>()).ThrowsAsync(new SeerrException("gone"));
        Seerr(By(Request(id: 1, tmdbId: 601), 7), By(Request(id: 2, tmdbId: 602), 7));

        var all = await Get();

        Assert.Equal(["movie-602"], all.Requests.Select(r => r.Item.Key));
        Assert.False(all.Partial);
    }

    [Fact]
    public async Task ATitleNotDescribedInTime_IsLeftOutThisOnce_AndTheAnswerSaysPartial()
    {
        var slow = new TaskCompletionSource<SeerrTitle>();
        _seerr.GetTitleSummaryAsync(Endpoint, Arg.Any<int>(), "movie", 601, Arg.Any<CancellationToken>()).Returns(slow.Task);
        Seerr(By(Request(id: 1, tmdbId: 601), 7), By(Request(id: 2, tmdbId: 602), 7));

        var answer = Get();
        while (!answer.IsCompleted)
        {
            _time.Advance(RequestProgressService.DetailsBudget);
            await Task.Delay(10);
        }

        var all = await answer;
        Assert.Equal(["movie-602"], all.Requests.Select(r => r.Item.Key));
        Assert.True(all.Partial);
        slow.SetResult(new SeerrTitle { Id = 601, Title = "Late" });
    }

    [Fact]
    public async Task SeerrFailing_Throws_AndTheFailureIsSharedBriefly()
    {
        _seerr.GetAllRequestsAsync(default!, default, default).ThrowsAsyncForAnyArgs(new SeerrException("down"));

        await Assert.ThrowsAsync<SeerrException>(Get);
        await Assert.ThrowsAsync<SeerrException>(Get);
        await _seerr.Received(1).GetAllRequestsAsync(Endpoint, EveryonesRequests.Take, Arg.Any<CancellationToken>());

        _time.Advance(RequestProgressService.FailureTtl);
        await Assert.ThrowsAsync<SeerrException>(Get);
        await _seerr.Received(2).GetAllRequestsAsync(Endpoint, EveryonesRequests.Take, Arg.Any<CancellationToken>());
    }

    [Fact]
    public void ARequester_IsTheJellyfinUserSeerrImportedThemFrom()
    {
        var bob = TestData.User("bob");
        _userManager.GetUserById(bob.Id).Returns(bob);
        _userManager.GetUserDto(bob, Arg.Any<string?>()).Returns(new UserDto { PrimaryImageTag = "tag1" });

        var requester = _service.Requester(Endpoint, new SeerrRequester { Id = 8, DisplayName = "Bobby (Seerr)", JellyfinUserId = bob.Id.ToString("N") });

        Assert.Equal(new RequesterDto("bob", bob.Id, "tag1"), requester);
    }

    [Fact]
    public void ARequester_SeerrDoesntLinkToJellyfin_IsTheUserLumenMappedToTheirAccount()
    {
        // Overseerr's users carry no Jellyfin id: the user whose Seerr account Lumen looked up lately is theirs.
        var carol = TestData.User("carol");
        _userManager.GetUserById(carol.Id).Returns(carol);
        _users.FindJellyfinUser(Endpoint, 9).Returns(carol.Id);

        var requester = _service.Requester(Endpoint, new SeerrRequester { Id = 9, DisplayName = "carol@example.com" });

        Assert.Equal(new RequesterDto("carol", carol.Id, null), requester);
    }

    [Fact]
    public void ARequester_LumenCantMatchToAJellyfinUser_IsTheirSeerrName()
    {
        _userManager.GetUserById(Arg.Any<Guid>()).Returns((Jellyfin.Database.Implementations.Entities.User?)null);

        // A Jellyfin id that's no longer a user (deleted), or none at all.
        Assert.Equal(new RequesterDto("Dave", null, null), _service.Requester(Endpoint, new SeerrRequester { Id = 10, DisplayName = " Dave ", JellyfinUserId = Guid.NewGuid().ToString("N") }));
        Assert.Equal(new RequesterDto("Eve", null, null), _service.Requester(Endpoint, new SeerrRequester { Id = 11, DisplayName = "Eve", JellyfinUserId = "not-a-guid" }));
        Assert.Equal(new RequesterDto(null, null, null), _service.Requester(Endpoint, new SeerrRequester { Id = 12, DisplayName = "  " }));
        Assert.Equal(EveryonesRequests.MaxNameLength, _service.Requester(Endpoint, new SeerrRequester { Id = 13, DisplayName = new string('x', 300) })!.Name!.Length);
        Assert.Null(_service.Requester(Endpoint, null));
    }

    [Fact]
    public async Task EachRequesterIsLookedUpOnce()
    {
        var bob = TestData.User("bob");
        _userManager.GetUserById(bob.Id).Returns(bob);
        var seerrBob = new SeerrRequester { Id = 8, JellyfinUserId = bob.Id.ToString("N") };
        Seerr(
            new SeerrUserRequest { Id = 1, Status = SeerrRequestStatus.Approved, Type = "movie", RequestedBy = seerrBob, Media = new SeerrRequestMedia { TmdbId = 601, MediaType = "movie", Status = 3 } },
            new SeerrUserRequest { Id = 2, Status = SeerrRequestStatus.Approved, Type = "movie", RequestedBy = seerrBob, Media = new SeerrRequestMedia { TmdbId = 602, MediaType = "movie", Status = 3 } });

        var all = await Get();

        Assert.All(all.Requests, r => Assert.Equal("bob", r.RequestedBy!.Name));
        _userManager.Received(1).GetUserById(bob.Id);
    }

    private static int SeerrIdOf(MyRequestDto request) => int.Parse(request.RequestedBy!.Name!["seerr ".Length..], System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>The request, filed by Seerr user <paramref name="seerrUserId"/> (named "seerr N", no Jellyfin user).</summary>
    private static SeerrUserRequest By(SeerrUserRequest request, int seerrUserId) => new()
    {
        Id = request.Id,
        Status = request.Status,
        Type = request.Type,
        CreatedAt = request.CreatedAt,
        Media = request.Media,
        RequestedBy = new SeerrRequester { Id = seerrUserId, DisplayName = "seerr " + seerrUserId },
    };

    private void Seerr(params SeerrUserRequest[] requests) =>
        _seerr.GetAllRequestsAsync(Endpoint, EveryonesRequests.Take, Arg.Any<CancellationToken>()).Returns(requests);

    private Task<AllRequestsDto> Get() => Get(1);

    private Task<AllRequestsDto> Get(int viewerSeerrUserId) => _service.GetAsync(null, Endpoint, viewerSeerrUserId, CancellationToken.None);
}
