using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;
using static Jellyfin.Plugin.Lumen.Tests.Requests.RequestProgressTests;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public class RequestProgressServiceTests
{
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/"), "k");
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly IReadyAnnouncements _announcements = Substitute.For<IReadyAnnouncements>();
    private readonly IReadyPushSignal _push = Substitute.For<IReadyPushSignal>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly PluginConfiguration _configuration = new() { ConfigVersion = 3 };
    private readonly RequestProgressService _service;
    private readonly Guid _alice = Guid.NewGuid();

    public RequestProgressServiceTests()
    {
        _config.Current.Returns(_configuration);
        _service = new RequestProgressService(_seerr, _config, new CatalogMapper(Substitute.For<ILibraryManager>()), _announcements, _push, _time);
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(
            call => new SeerrTitle { Id = call.ArgAt<int>(3), Title = "Title " + call.ArgAt<int>(3), Name = "Show " + call.ArgAt<int>(3) });
        _announcements.Update(default, default!, default!, default!, default!).ReturnsForAnyArgs(new HashSet<int>());
        _announcements.PopUpOnly(default, default!).ReturnsForAnyArgs(new HashSet<int>());
    }

    [Fact]
    public async Task ListsTheUsersTitles_NewestFirst_WithTheirProgress()
    {
        // Request ids count down in time here (RequestProgressTests.Request): 1 is the newest.
        Requests(7, Request(SeerrRequestStatus.Pending, id: 2, tmdbId: 601), Request(downloads: [Download(1000, 600, "downloading", TestData.Now.AddMinutes(2))], id: 1, tmdbId: 602));

        var mine = await Get(7);

        Assert.Equal(["movie-602", "movie-601"], mine.Requests.Select(r => r.Item.Key));
        var downloading = mine.Requests[0];
        Assert.Equal((RequestProgressState.Downloading, 40d, 120), (downloading.Status, downloading.Percent!.Value, downloading.SecondsLeft!.Value));
        Assert.Equal("Title 602", downloading.Item.Title);
        Assert.Equal(RequestProgressState.Requested, mine.Requests[1].Status);
    }

    [Fact]
    public async Task AsksSeerrAsTheUser_ForTheirOwnRequestsOnly()
    {
        Requests(7);
        Requests(8);

        await Get(7);
        await Get(8);

        await _seerr.Received(1).GetUserRequestsAsync(Endpoint, 7, Arg.Any<CancellationToken>(), RequestProgressService.Take);
        await _seerr.Received(1).GetUserRequestsAsync(Endpoint, 8, Arg.Any<CancellationToken>(), RequestProgressService.Take);
    }

    [Fact]
    public async Task OneUsersCachedAnswer_IsNeverAnothers()
    {
        Requests(7, Request(id: 1, tmdbId: 601));
        Requests(8, Request(id: 2, tmdbId: 602));

        Assert.Equal(["movie-601"], (await Get(7)).Requests.Select(r => r.Item.Key));
        Assert.Equal(["movie-602"], (await Get(8)).Requests.Select(r => r.Item.Key));
        Assert.Equal(["movie-601"], (await Get(7)).Requests.Select(r => r.Item.Key));
    }

    [Fact]
    public async Task CachesSeerrsAnswerBriefly()
    {
        Requests(7, Request(downloads: [Download(1000, 600, "downloading", TestData.Now.AddMinutes(2))]));

        await Get(7);
        _time.Advance(TimeSpan.FromSeconds(5));
        var cached = await Get(7);
        await _seerr.Received(1).GetUserRequestsAsync(Endpoint, 7, Arg.Any<CancellationToken>(), RequestProgressService.Take);

        // The time left still counts down from the cached estimate.
        Assert.Equal(115, cached.Requests[0].SecondsLeft);

        _time.Advance(RequestProgressService.Ttl);
        await Get(7);
        await _seerr.Received(2).GetUserRequestsAsync(Endpoint, 7, Arg.Any<CancellationToken>(), RequestProgressService.Take);
    }

    [Fact]
    public async Task SavingLumensSettings_StartsTheCacheOver()
    {
        Requests(7);
        await Get(7);
        _configuration.ConfigVersion++;
        await Get(7);

        await _seerr.Received(2).GetUserRequestsAsync(Endpoint, 7, Arg.Any<CancellationToken>(), Arg.Any<int>());
    }

    [Fact]
    public async Task CallsThatArriveTogether_ShareOneSeerrCall()
    {
        var answer = new TaskCompletionSource<IReadOnlyList<SeerrUserRequest>>();
        _seerr.GetUserRequestsAsync(Endpoint, 7, Arg.Any<CancellationToken>(), Arg.Any<int>()).Returns(answer.Task);

        var calls = Enumerable.Range(0, 5).Select(_ => Get(7)).ToList();
        answer.SetResult([Request()]);
        var results = await Task.WhenAll(calls);

        Assert.All(results, r => Assert.Single(r.Requests));
        await _seerr.Received(1).GetUserRequestsAsync(Endpoint, 7, Arg.Any<CancellationToken>(), Arg.Any<int>());
    }

    [Fact]
    public async Task AFailure_IsCachedBriefly_SoOneUserCantKeepSeerrBusy()
    {
        _seerr.GetUserRequestsAsync(Endpoint, 7, Arg.Any<CancellationToken>(), Arg.Any<int>()).ThrowsAsync(new SeerrException("down"));
        await Assert.ThrowsAsync<SeerrException>(() => Get(7));

        // Another tab (or device) a moment later gets the same failure, without a Seerr call.
        Requests(7, Request());
        _time.Advance(RequestProgressService.FailureTtl - TimeSpan.FromSeconds(1));
        await Assert.ThrowsAsync<SeerrException>(() => Get(7));
        await _seerr.Received(1).GetUserRequestsAsync(Endpoint, 7, Arg.Any<CancellationToken>(), Arg.Any<int>());

        // Not another user's.
        Requests(8, Request());
        Assert.Single((await Get(8)).Requests);

        _time.Advance(TimeSpan.FromSeconds(1));
        Assert.Single((await Get(7)).Requests);
    }

    [Fact]
    public async Task AFailure_IsForgotten_WhenTheUserFilesARequest()
    {
        _seerr.GetUserRequestsAsync(Endpoint, 7, Arg.Any<CancellationToken>(), Arg.Any<int>()).ThrowsAsync(new SeerrException("down"));
        await Assert.ThrowsAsync<SeerrException>(() => Get(7));

        Requests(7, Request());
        _service.Invalidate(Endpoint, 7);
        Assert.Single((await Get(7)).Requests);
    }

    [Fact]
    public async Task ATitleRemovedFromTheServer_IsLeftOut_NotShownReady()
    {
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 7, id: 1, tmdbId: 601), Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 2, tmdbId: 602));

        var mine = await Get(7);

        Assert.Equal(["movie-602"], mine.Requests.Select(r => r.Item.Key));
        _announcements.Received().Update(_alice, Arg.Any<string>(), Arg.Any<IEnumerable<int>>(), Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new List<int> { 2 })), Arg.Any<IEnumerable<int>>());
    }

    [Fact]
    public async Task AShowWithTwoSeasonRequestsInFlight_ShowsBoth_AndNotOtherSeasons()
    {
        var downloads = new List<SeerrDownload>
        {
            Download(1000, 0, "downloading", null, "s1", 1, 1),
            Download(1000, 500, "downloading", null, "s2", 2, 1),
            Download(1000, 1000, "queued", null, "s3", 3, 1),
        };
        Requests(7, Season(6, 3, downloads), Season(5, 2, downloads));

        var title = Assert.Single((await Get(7)).Requests);

        Assert.Equal([6, 5], title.RequestIds);
        Assert.Equal(25, title.Percent); // seasons 2 and 3: 500 of 2000
        Assert.Equal((0, 2), (title.EpisodesDone, title.EpisodesTotal));
    }

    [Fact]
    public async Task ASeasonDownloading_IsShown_OverANewerSeasonWaitingForApproval()
    {
        var downloads = new List<SeerrDownload> { Download(1000, 400, "downloading", null, "s1", 1, 1) };
        var approved = Season(5, 1, downloads);
        var second = Season(6, 2, downloads);
        var pending = new SeerrUserRequest { Id = second.Id, Status = SeerrRequestStatus.Pending, Type = "tv", CreatedAt = second.CreatedAt, Seasons = second.Seasons, Media = second.Media };
        Requests(7, pending, approved);

        var title = Assert.Single((await Get(7)).Requests);

        Assert.Equal(RequestProgressState.Downloading, title.Status);
        Assert.Equal(60, title.Percent);
    }

    [Fact]
    public async Task Invalidate_AsksSeerrAgain()
    {
        Requests(7);
        await Get(7);
        _service.Invalidate(Endpoint, 7);
        await Get(7);

        await _seerr.Received(2).GetUserRequestsAsync(Endpoint, 7, Arg.Any<CancellationToken>(), Arg.Any<int>());
    }

    [Fact]
    public async Task AShowsSeparateSeasonRequests_AreOneTitle_ShowingTheOneInFlight()
    {
        Requests(
            7,
            Request(SeerrRequestStatus.Approved, downloads: [Download(1000, 500, "downloading", null, "e1", 2, 1), Download(1000, 1000, "queued", null, "e2", 2, 2)], id: 5, tmdbId: 1399, type: "tv"),
            Request(SeerrRequestStatus.Completed, mediaStatus: 4, id: 3, tmdbId: 1399, type: "tv"));

        var title = Assert.Single((await Get(7)).Requests);

        Assert.Equal("tv-1399", title.Item.Key);
        Assert.Equal("Show 1399", title.Item.Title);
        Assert.Equal([5, 3], title.RequestIds);
        Assert.Equal(RequestProgressState.Downloading, title.Status);
        Assert.Equal((0, 2), (title.EpisodesDone, title.EpisodesTotal));
    }

    [Fact]
    public async Task ADownloadThatLeftTheQueue_IsProcessing_NotQueuedAgain()
    {
        Requests(7, Request(downloads: [Download(1000, 0, "completed")]));
        Assert.Equal(RequestProgressState.Processing, (await Get(7)).Requests[0].Status);

        _time.Advance(TimeSpan.FromMinutes(1));
        Requests(7, Request(downloads: []));
        Assert.Equal(RequestProgressState.Processing, (await Get(7)).Requests[0].Status);
    }

    [Fact]
    public async Task ReadyTitlesSeenInFlight_AreAnnounced()
    {
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 4), Request(SeerrRequestStatus.Pending, id: 6, tmdbId: 700), Request(SeerrRequestStatus.Declined, id: 2, tmdbId: 701));
        _announcements.Update(_alice, "http://seerr:5055/", Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>()).Returns(new HashSet<int> { 4 });

        var mine = await Get(7);

        Assert.True(mine.Requests.Single(r => r.Item.Key == "movie-603").Announce);
        Assert.False(mine.Requests.Single(r => r.Item.Key == "movie-700").Announce);

        // The declined one is in neither list: that's what has it forgotten. 6 has waited for approval for six days.
        _announcements.Received().Update(
            _alice,
            "http://seerr:5055/",
            Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new List<int> { 6 })),
            Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new List<int> { 4 })),
            Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new List<int> { 6 })));
    }

    [Fact]
    public async Task RequestsThatHaveOnlyWaitedOverADay_AreSaidToBeWaiting_NeverOnesDownloading()
    {
        SeerrUserRequest Created(SeerrUserRequest request, TimeSpan ago) => new()
        {
            Id = request.Id,
            Status = request.Status,
            Type = request.Type,
            CreatedAt = TestData.Now - ago,
            Media = request.Media,
        };
        Requests(
            7,
            Created(Request(SeerrRequestStatus.Pending, id: 1, tmdbId: 701), TimeSpan.FromDays(3)), // awaiting approval for days
            Created(Request(SeerrRequestStatus.Pending, id: 2, tmdbId: 702), TimeSpan.FromHours(2)), // only just asked for
            Created(Request(id: 3, tmdbId: 703), TimeSpan.FromDays(40)), // approved, no release yet
            Created(Request(id: 4, tmdbId: 704), TimeSpan.FromHours(23)), // approved today
            Created(Request(downloads: [Download(1000, 400, "downloading")], id: 5, tmdbId: 705), TimeSpan.FromDays(40))); // old, but downloading now

        await Get(7);

        _announcements.Received().Update(
            _alice,
            "http://seerr:5055/",
            Arg.Is<IEnumerable<int>>(ids => ids.Order().SequenceEqual(new List<int> { 1, 2, 3, 4, 5 })),
            Arg.Is<IEnumerable<int>>(ids => !ids.Any()),
            Arg.Is<IEnumerable<int>>(ids => ids.Order().SequenceEqual(new List<int> { 1, 3 })));
    }

    [Fact]
    public async Task WithNotificationsOn_WhatThePushJobGaveUpOn_GetsThePopUp_AndWakesNobody()
    {
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 4), Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 5, tmdbId: 604));
        _announcements.Update(_alice, "http://seerr:5055/", Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>()).Returns(new HashSet<int> { 4 });
        _announcements.PopUpOnly(_alice, "http://seerr:5055/").Returns(new HashSet<int> { 4 });
        _push.Covers(_alice).Returns(true);

        var mine = await Get(7);

        // No device could be reached for 4: the user hears of it here, and the job isn't woken to try yet again.
        Assert.True(mine.Requests.Single(r => r.Item.Key == "movie-603").Announce);
        Assert.False(mine.Requests.Single(r => r.Item.Key == "movie-604").Announce);
        _push.DidNotReceiveWithAnyArgs().Wake(default);
    }

    [Fact]
    public async Task WithNotificationsOn_OneLeftToThePopUp_AndOneStillToPush_DoesBoth()
    {
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 4), Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 5, tmdbId: 604));
        _announcements.Update(_alice, "http://seerr:5055/", Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>()).Returns(new HashSet<int> { 4, 5 });
        _announcements.PopUpOnly(_alice, "http://seerr:5055/").Returns(new HashSet<int> { 4 });
        _push.Covers(_alice).Returns(true);

        var mine = await Get(7);

        Assert.True(mine.Requests.Single(r => r.Item.Key == "movie-603").Announce);
        Assert.False(mine.Requests.Single(r => r.Item.Key == "movie-604").Announce);
        _push.Received(1).Wake(_alice);
    }

    [Fact]
    public async Task WithNotificationsOn_AReadyTitleIsLeftToThePush_NotThePopUp()
    {
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 4));
        _announcements.Update(_alice, "http://seerr:5055/", Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>()).Returns(new HashSet<int> { 4 });
        _push.Covers(_alice).Returns(true);

        var mine = await Get(7);

        // The push job is told to send it now, and takes it itself: the request list never marks it for a pop-up.
        Assert.False(mine.Requests.Single().Announce);
        _push.Received(1).Wake(_alice);
        _announcements.DidNotReceiveWithAnyArgs().MarkAnnounced(default, default!, default!);
    }

    [Fact]
    public async Task WithNotificationsOn_NothingReady_WakesNobody()
    {
        Requests(7, Request(SeerrRequestStatus.Pending, id: 6));
        _push.Covers(_alice).Returns(true);

        await Get(7);

        _push.DidNotReceiveWithAnyArgs().Wake(default);
    }

    [Fact]
    public async Task ClaimReady_TakesWhatIsReady_NamedByItsTitle()
    {
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 4, tmdbId: 603), Request(SeerrRequestStatus.Pending, id: 6, tmdbId: 700), Request(SeerrRequestStatus.Declined, id: 2, tmdbId: 701));
        _announcements.Claim(_alice, "http://seerr:5055/", Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>(), Arg.Any<IEnumerable<int>>()).Returns(new HashSet<int> { 4 });

        var ready = await _service.ClaimReadyAsync(_alice, TestData.User(), Endpoint, 7, null, CancellationToken.None);

        var title = Assert.Single(ready);
        Assert.Equal(("movie-603", "Title 603"), (title.Key, title.Item!.Title));
        Assert.Equal([4], title.RequestIds);
        _announcements.Received().Claim(
            _alice,
            "http://seerr:5055/",
            Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new List<int> { 6 })),
            Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new List<int> { 4 })),
            Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new List<int> { 6 })),
            Arg.Is<IEnumerable<int>>(ids => !ids.Any()),
            Arg.Is<IEnumerable<int>>(ids => !ids.Any()));
    }

    [Fact]
    public async Task ClaimReady_WatchesARequestSeerrsWebhookNamed_OnlyIfItIsThisUsersAndReady()
    {
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 4), Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 5, tmdbId: 604));
        _announcements.Claim(default, default!, default!, default!, default!, default, default).ReturnsForAnyArgs(new HashSet<int>());

        await _service.ClaimReadyAsync(_alice, TestData.User(), Endpoint, 7, [4, 99], CancellationToken.None);

        // 4 is this user's and ready; 99 is somebody else's; 5 wasn't named, so it stays unwatched.
        _announcements.Received().Claim(
            _alice,
            "http://seerr:5055/",
            Arg.Is<IEnumerable<int>>(ids => !ids.Any()),
            Arg.Any<IEnumerable<int>>(),
            Arg.Any<IEnumerable<int>>(),
            Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new List<int> { 4 })),
            Arg.Any<IEnumerable<int>>());
    }

    [Fact]
    public async Task ClaimReady_ATitleSeerrCantDescribe_ComesWithoutAName_ToGiveBack()
    {
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 4, tmdbId: 602));
        _announcements.Claim(default, default!, default!, default!, default!, default, default).ReturnsForAnyArgs(new HashSet<int> { 4 });
        _seerr.GetTitleSummaryAsync(Endpoint, 7, "movie", 602, Arg.Any<CancellationToken>()).ThrowsAsync(new SeerrException("404"));

        var title = Assert.Single(await _service.ClaimReadyAsync(_alice, TestData.User(), Endpoint, 7, null, CancellationToken.None));

        Assert.Null(title.Item);
        _service.GiveBack(_alice, Endpoint, title.RequestIds);
        _announcements.Received(1).GiveBack(_alice, "http://seerr:5055/", Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new List<int> { 4 })));

        // Or, when no device could be reached, left to the pop-up.
        _service.Release(_alice, Endpoint, title.RequestIds);
        _announcements.Received(1).Release(_alice, "http://seerr:5055/", Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new List<int> { 4 })));
    }

    [Fact]
    public async Task ATitleSeerrCantDescribe_IsLeftOut()
    {
        Requests(7, Request(id: 1, tmdbId: 601), Request(id: 2, tmdbId: 602));
        _seerr.GetTitleSummaryAsync(Endpoint, 7, "movie", 602, Arg.Any<CancellationToken>()).ThrowsAsync(new SeerrException("404"));

        Assert.Equal(["movie-601"], (await Get(7)).Requests.Select(r => r.Item.Key));
    }

    private static SeerrUserRequest Season(int id, int season, IReadOnlyList<SeerrDownload> downloads)
    {
        var request = Request(downloads: downloads, id: id, tmdbId: 1399, type: "tv");
        return new SeerrUserRequest { Id = id, Status = request.Status, Type = "tv", CreatedAt = request.CreatedAt, Seasons = [new SeerrSeasonStatus { SeasonNumber = season }], Media = request.Media };
    }

    private void Requests(int seerrUserId, params SeerrUserRequest[] requests) =>
        _seerr.GetUserRequestsAsync(Endpoint, seerrUserId, Arg.Any<CancellationToken>(), Arg.Any<int>()).Returns(requests);

    private Task<Jellyfin.Plugin.Lumen.Api.MyRequestsDto> Get(int seerrUserId) =>
        _service.GetAsync(_alice, TestData.User(), Endpoint, seerrUserId, CancellationToken.None);
}
