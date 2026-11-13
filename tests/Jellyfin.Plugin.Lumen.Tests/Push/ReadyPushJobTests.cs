using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Push;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;
using static Jellyfin.Plugin.Lumen.Tests.Push.PushSubscriptionStoreTests;
using static Jellyfin.Plugin.Lumen.Tests.Requests.RequestProgressTests;

namespace Jellyfin.Plugin.Lumen.Tests.Push;

/// <summary>
/// The push job with the real request list, announcement list and subscription store behind it: only Seerr and the
/// push service are stand-ins. What matters is "once per request", whoever looks first.
/// </summary>
public sealed class ReadyPushJobTests : IDisposable
{
    private static readonly SeerrEndpoint Endpoint = new(new Uri("http://seerr:5055/"), "k");
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "lumen-push-" + Guid.NewGuid().ToString("N"));
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly ISeerrUserMap _users = Substitute.For<ISeerrUserMap>();
    private readonly IWebPushClient _pushService = Substitute.For<IWebPushClient>();
    private readonly ISignedInDevices _signedIn = Substitute.For<ISignedInDevices>();
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly PushSubscriptionStore _subscriptions;
    private readonly ReadyAnnouncements _announcements;
    private readonly ReadyPushSignal _signal;
    private readonly RequestProgressService _progress;
    private readonly ReadyPushJob _job;
    private readonly List<(string Device, JsonElement Message)> _sent = [];
    private readonly Guid _alice = Guid.NewGuid();
    private readonly Guid _bob = Guid.NewGuid();
    private PushOutcome _outcome = PushOutcome.Sent;

    public ReadyPushJobTests()
    {
        _config.Current.Returns(new PluginConfiguration { ConfigVersion = 3 });
        _subscriptions = new PushSubscriptionStore(Path.Combine(_dir, "push-subscriptions.json"), NullLogger<PushSubscriptionStore>.Instance);
        _announcements = new ReadyAnnouncements(Path.Combine(_dir, "ready-announcements.json"), NullLogger<ReadyAnnouncements>.Instance);
        _signal = new ReadyPushSignal(_subscriptions) { Running = true };
        _progress = new RequestProgressService(_seerr, _config, new CatalogMapper(Substitute.For<ILibraryManager>()), _announcements, _signal, _time);
        _signedIn.IsSignedIn(default, default!).ReturnsForAnyArgs(true);
        _pushService.SendAsync(default!, default, default, default).ReturnsForAnyArgs(call =>
        {
            var outcome = _outcome;
            if (outcome == PushOutcome.Sent)
            {
                lock (_sent)
                {
                    _sent.Add((call.Arg<PushSubscription>().DeviceId, JsonDocument.Parse(Encoding.UTF8.GetString(call.ArgAt<ReadOnlyMemory<byte>>(1).Span)).RootElement.Clone()));
                }
            }

            return new PushResult(outcome, outcome == PushOutcome.Sent ? 201 : outcome == PushOutcome.Gone ? 410 : 503);
        });
        var sender = new PushSender(_subscriptions, _pushService, _signedIn, _time, NullLogger<PushSender>.Instance);
        _job = new ReadyPushJob(_signal, _subscriptions, _announcements, _users, _progress, sender, Substitute.For<IUserManager>(), _time, NullLogger<ReadyPushJob>.Instance);

        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(
            call => new SeerrTitle { Id = call.ArgAt<int>(3), Title = "Title " + call.ArgAt<int>(3), PosterPath = "/poster.jpg" });
        _users.GetAccessAsync(_alice, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, 7, Endpoint));
        _users.GetAccessAsync(_bob, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, 8, Endpoint));
        Requests(8);
    }

    public void Dispose()
    {
        _job.Dispose();
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, true);
        }
    }

    [Fact]
    public async Task ARequestSeenInFlight_IsPushedWhenReady_Once()
    {
        Subscribe(_alice, "phone");
        Requests(7, Request(id: 4, tmdbId: 603));
        await Pass(discover: true);
        Assert.Empty(_sent);

        NextAnswer();
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 4, tmdbId: 603));
        await Pass();

        var (device, message) = Assert.Single(_sent);
        Assert.Equal("phone", device);
        Assert.Equal("Title 603 is ready to watch", message.GetProperty("title").GetString());
        Assert.Equal("movie-603", message.GetProperty("key").GetString());
        Assert.Equal("Lumen/Requests/Image/w780/poster.jpg?t=" + Uri.EscapeDataString(CatalogImageToken.Create(_alice, "k")), message.GetProperty("image").GetString());

        // Every later pass, a discovery pass, and a restart of the job's memory: never again.
        NextAnswer();
        await Pass();
        await Pass(discover: true);
        await _job.RunAsync(new ReadyPushWork(_alice), CancellationToken.None);
        await _job.RunAsync(new ReadyPushWork(null, 4), CancellationToken.None);
        Assert.Single(_sent);
    }

    [Fact]
    public async Task ThePush_GoesToEveryDeviceTheUserTurnedItOnIn_AndNoOtherUsers()
    {
        Subscribe(_alice, "phone");
        Subscribe(_alice, "laptop");
        Subscribe(_bob, "bobs-phone");
        await SeenInFlightThenReady(7, id: 4);

        await Pass();

        Assert.Equal(["laptop", "phone"], _sent.Select(s => s.Device).Order());
    }

    [Fact]
    public async Task OncePushed_ThePopUpNeverShowsForIt()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        await Pass();
        Assert.Single(_sent);

        var mine = await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None);

        Assert.Equal(RequestProgressState.Ready, Assert.Single(mine.Requests).Status);
        Assert.False(mine.Requests[0].Announce);
    }

    [Fact]
    public async Task WhenAnOpenPageSeesItFirst_ThePushIsSentAtOnce_AndStillNoPopUp()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);

        // The page's own check, before any pass of the job.
        var mine = await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None);
        Assert.False(Assert.Single(mine.Requests).Announce);
        Assert.Empty(_sent);

        // It woke the job for this user.
        Assert.True(_signal.Work.TryRead(out var work));
        Assert.Equal(new ReadyPushWork(_alice), work);
        await _job.RunAsync(work!, CancellationToken.None);
        Assert.Single(_sent);

        // And the page's next checks change nothing.
        mine = await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None);
        Assert.False(mine.Requests[0].Announce);
        Assert.False(_signal.Work.TryRead(out _));
        await Pass();
        Assert.Single(_sent);
    }

    [Fact]
    public async Task AUserWithoutNotifications_KeepsThePopUp_AndGetsNoPush()
    {
        Subscribe(_bob, "bobs-phone");
        await SeenInFlightThenReady(7, id: 4);

        await Pass(discover: true);
        Assert.Empty(_sent);

        var mine = await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None);
        Assert.True(Assert.Single(mine.Requests).Announce);
        Assert.False(_signal.Work.TryRead(out _));
    }

    [Fact]
    public async Task WhileTheJobIsntRunning_ThePopUpStays()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        _signal.Running = false;

        var mine = await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None);

        Assert.True(Assert.Single(mine.Requests).Announce);
    }

    [Fact]
    public async Task APushNoDeviceTook_IsDueAgainNextPass()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers(PushOutcome.Failed);

        await Pass();
        Assert.Empty(_sent);

        PushServiceAnswers(PushOutcome.Sent);
        NextAnswer();
        await Pass();
        Assert.Single(_sent);

        NextAnswer();
        await Pass();
        Assert.Single(_sent);
    }

    [Fact]
    public async Task WhenTheOnlyDeviceIsGone_ItsSubscriptionIsRemoved_AndThePopUpTakesOver()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers(PushOutcome.Gone);

        await Pass();

        // 410: cleaned up, and nobody was told, so the request is still due, now for the pop-up.
        Assert.False(_subscriptions.HasAny(_alice));
        var mine = await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None);
        Assert.True(Assert.Single(mine.Requests).Announce);
    }

    [Fact]
    public async Task APass_AsksSeerrOnlyForUsersWithNotificationsOn_AndARequestInFlight()
    {
        Subscribe(_alice, "phone");
        Subscribe(_bob, "bobs-phone");
        var carol = Guid.NewGuid(); // requests in flight, but no notifications
        _announcements.Update(carol, Endpoint.BaseUrl.ToString(), [50], [], []);
        _announcements.Update(_alice, Endpoint.BaseUrl.ToString(), [4], [], []);
        Requests(7, Request(id: 4));

        await Pass();

        await _seerr.Received(1).GetUserRequestsAsync(Endpoint, 7, Arg.Any<CancellationToken>(), Arg.Any<int>());
        await _seerr.DidNotReceive().GetUserRequestsAsync(Endpoint, 8, Arg.Any<CancellationToken>(), Arg.Any<int>());
        await _users.DidNotReceive().GetAccessAsync(carol, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ADiscoveryPass_FindsRequestsFiledInSeerrItself_AndFollowsThemFromThen()
    {
        Subscribe(_alice, "phone");
        Requests(7, Request(id: 4)); // filed in Seerr: Lumen has never seen it

        await Pass();
        await _seerr.DidNotReceiveWithAnyArgs().GetUserRequestsAsync(default!, default, default);

        await Pass(discover: true);
        Assert.True(_announcements.IsWatching(_alice));

        NextAnswer();
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 4));
        await Pass();
        Assert.Single(_sent);
    }

    [Fact]
    public async Task ARequestThatWasReadyBeforeLumenLooked_IsNeverPushed()
    {
        Subscribe(_alice, "phone");
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 4));

        await Pass(discover: true);

        Assert.Empty(_sent);
    }

    [Fact]
    public async Task SeerrsWebhook_AnnouncesTheRequestItNames_EvenNeverSeenInFlight_ToItsOwnerOnly()
    {
        Subscribe(_alice, "phone");
        Subscribe(_bob, "bobs-phone");
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 4), Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 5, tmdbId: 604));

        await _job.RunAsync(new ReadyPushWork(null, 4), CancellationToken.None);

        var (device, message) = Assert.Single(_sent);
        Assert.Equal("phone", device);
        Assert.Equal("Title 603 is ready to watch", message.GetProperty("title").GetString());

        // Seerr may call again for the same request (another season's episode): still once.
        NextAnswer();
        await _job.RunAsync(new ReadyPushWork(null, 4), CancellationToken.None);
        Assert.Single(_sent);
    }

    [Fact]
    public async Task UpToThreeTitlesReadyAtOnce_GetANotificationEach_MoreGetOne()
    {
        Subscribe(_alice, "phone", "de-DE");
        await SeenInFlightThenReady(7, 1, 2, 3);
        await Pass();
        Assert.Equal(["Title 601 is ready to watch", "Title 602 is ready to watch", "Title 603 is ready to watch"], _sent.Select(s => s.Message.GetProperty("title").GetString()).Order());

        _sent.Clear();
        NextAnswer();
        await SeenInFlightThenReady(7, 11, 12, 13, 14);
        await Pass();

        var summary = Assert.Single(_sent).Message;
        Assert.Equal("4 of your requests are ready to watch", summary.GetProperty("title").GetString());
        Assert.Equal("requests", summary.GetProperty("page").GetString());

        NextAnswer();
        await Pass();
        Assert.Single(_sent);
    }

    [Fact]
    public async Task AShowWithAnotherSeasonStillDownloading_IsAnnouncedOnce_WhenAllOfItIsReady()
    {
        Subscribe(_alice, "phone");
        SeerrUserRequest Season(int id, int season, int status, int mediaStatus) => new()
        {
            Id = id,
            Status = status,
            Type = "tv",
            CreatedAt = TestData.Now.AddDays(-id),
            Seasons = [new SeerrSeasonStatus { SeasonNumber = season }],
            Media = new SeerrRequestMedia { TmdbId = 1399, MediaType = "tv", Status = mediaStatus, DownloadStatus = [] },
        };
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(new SeerrTitle { Id = 1399, Name = "Lumen Saga" });
        _announcements.Update(_alice, Endpoint.BaseUrl.ToString(), [1, 2], [], []);

        // Season 1's request is complete, season 2's still on its way: as with the pop-up, not yet.
        Requests(7, Season(1, 1, SeerrRequestStatus.Completed, 4), Season(2, 2, SeerrRequestStatus.Approved, 4));
        await Pass();
        Assert.Empty(_sent);

        NextAnswer();
        Requests(7, Season(1, 1, SeerrRequestStatus.Completed, 5), Season(2, 2, SeerrRequestStatus.Completed, 5));
        await Pass();
        Assert.Equal("Lumen Saga is ready to watch", Assert.Single(_sent).Message.GetProperty("title").GetString());

        NextAnswer();
        await Pass(discover: true);
        Assert.Single(_sent);
    }

    [Fact]
    public async Task ATitleSeerrCantName_WaitsForTheNextPass()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ThrowsAsyncForAnyArgs(new SeerrException("down"));

        await Pass();
        Assert.Empty(_sent);

        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(new SeerrTitle { Id = 603, Title = "Dune" });
        NextAnswer();
        await Pass();
        Assert.Equal("Dune is ready to watch", Assert.Single(_sent).Message.GetProperty("title").GetString());
    }

    [Fact]
    public async Task SeerrBeingDown_OrAUserWithoutAccess_EndsNothing()
    {
        Subscribe(_alice, "phone");
        Subscribe(_bob, "bobs-phone");
        _announcements.Update(_alice, Endpoint.BaseUrl.ToString(), [4], [], []);
        _announcements.Update(_bob, Endpoint.BaseUrl.ToString(), [9], [], []);
        _seerr.GetUserRequestsAsync(Endpoint, 7, Arg.Any<CancellationToken>(), Arg.Any<int>()).ThrowsAsync(new SeerrException("down"));
        _users.GetAccessAsync(_bob, Arg.Any<CancellationToken>()).Returns(RequestAccess.None);

        await Pass();

        Assert.Empty(_sent);
        await _seerr.DidNotReceive().GetUserRequestsAsync(Endpoint, 8, Arg.Any<CancellationToken>(), Arg.Any<int>());
        Assert.True(_announcements.IsWatching(_alice));
    }

    [Fact]
    public async Task TheJob_RunsItsPasses_AndTheWorkItsWokenFor()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        _signal.Running = false;

        await _job.StartAsync(CancellationToken.None);
        await WaitFor(() => _signal.Running);

        // The first pass comes after the start delay.
        await WaitFor(() => _sent.Count == 1);

        // Between passes, a woken user is checked at once.
        Subscribe(_bob, "bobs-phone");
        Requests(8, Request(id: 9, tmdbId: 700));
        await _progress.GetAsync(_bob, TestData.User(), Endpoint, 8, CancellationToken.None);
        _time.Advance(RequestProgressService.Ttl + TimeSpan.FromSeconds(1));
        Requests(8, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 9, tmdbId: 700));
        _signal.Wake(_bob);
        await WaitFor(() => _sent.Count == 2);
        Assert.Equal("bobs-phone", _sent[1].Device);

        await _job.StopAsync(CancellationToken.None);
        Assert.False(_signal.Running);
    }

    /// <summary>The job runs on its own thread, on the test's clock: lets both move on until <paramref name="condition"/> holds.</summary>
    private async Task WaitFor(Func<bool> condition)
    {
        for (var i = 0; i < 400 && !condition(); i++)
        {
            _time.Advance(TimeSpan.FromSeconds(1));
            await Task.Delay(10);
        }

        Assert.True(condition());
    }

    private void Subscribe(Guid user, string device, string? locale = null) =>
        _subscriptions.Save(user, Subscription(device, "https://web.push.apple.com/" + device, locale));

    private void Requests(int seerrUserId, params SeerrUserRequest[] requests) =>
        _seerr.GetUserRequestsAsync(Endpoint, seerrUserId, Arg.Any<CancellationToken>(), Arg.Any<int>()).Returns(requests);

    /// <summary>Past the request list's cache, so the next check asks "Seerr" again.</summary>
    private void NextAnswer() => _time.Advance(RequestProgressService.Ttl + TimeSpan.FromSeconds(1));

    /// <summary>Lumen sees the user's requests in flight (ids are also tmdb 600 + id), then Seerr says they're ready.</summary>
    private async Task SeenInFlightThenReady(int seerrUserId, params int[] id)
    {
        var user = seerrUserId == 7 ? _alice : _bob;
        _announcements.Update(user, Endpoint.BaseUrl.ToString(), id, [], []);
        Requests(seerrUserId, id.Select(i => Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: i, tmdbId: i == 4 ? 603 : 600 + i)).ToArray());
        await Task.CompletedTask;
    }

    private Task Pass(bool discover = false) => _job.RunPassAsync(discover, CancellationToken.None);

    private void PushServiceAnswers(PushOutcome outcome) => _outcome = outcome;
}
