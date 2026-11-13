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
/// The push job with the real request list, announcement list, subscription store and sender behind it: only Seerr and
/// the push service are stand-ins. What matters is "once per request", whoever looks first, and that a user always
/// hears of it: by a push to each device, or, when no device can be reached, by the pop-up.
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

    /// <summary>Every call to the push service, whatever it answered: the device it was for.</summary>
    private readonly List<string> _attempts = [];

    /// <summary>What the push service answers for one device, where that isn't <see cref="_outcome"/>.</summary>
    private readonly Dictionary<string, PushOutcome> _outcomes = [];
    private readonly ListLogger<PushSender> _senderLog = new();
    private readonly PushSender _sender;
    private readonly List<ReadyPushJob> _jobs = [];
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
            var device = call.Arg<PushSubscription>().DeviceId;
            PushOutcome outcome;
            lock (_sent)
            {
                outcome = _outcomes.GetValueOrDefault(device, _outcome);
                _attempts.Add(device);
                if (outcome == PushOutcome.Sent)
                {
                    using var payload = JsonDocument.Parse(Encoding.UTF8.GetString(call.ArgAt<ReadOnlyMemory<byte>>(1).Span));
                    _sent.Add((device, payload.RootElement.Clone()));
                }
            }

            return new PushResult(outcome, outcome switch { PushOutcome.Sent => 201, PushOutcome.Gone => 410, PushOutcome.Rejected => 403, _ => 503 });
        });
        _sender = new PushSender(_subscriptions, _pushService, _signedIn, _time, _senderLog);
        _job = Job(ReadyPushTimings.Default);

        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(
            call => new SeerrTitle { Id = call.ArgAt<int>(3), Title = "Title " + call.ArgAt<int>(3), PosterPath = "/poster.jpg" });
        _users.GetAccessAsync(_alice, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, 7, Endpoint));
        _users.GetAccessAsync(_bob, Arg.Any<CancellationToken>()).Returns(new RequestAccess(true, true, true, 8, Endpoint));
        Requests(8);
    }

    public void Dispose()
    {
        _jobs.ForEach(job => job.Dispose());
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, true);
        }
    }

    [Fact]
    public async Task ARequestSeenInFlight_IsPushedWhenReady_Once()
    {
        Subscribe(_alice, "phone");
        Requests(7, Downloading(id: 4, tmdbId: 603));
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
    public async Task APushTheServiceDidntTake_IsSentAgain_ButNoSoonerThanAPassLater_WhoeverWakesTheJob()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers(PushOutcome.Failed);

        await Pass();
        Assert.Empty(_sent);
        Assert.Single(_attempts);
        Assert.Equal(1, _job.Owed);

        // Meanwhile an open page checks, as often as it likes: no pop-up yet, and it doesn't wake the job either.
        for (var i = 0; i < 5; i++)
        {
            NextAnswer();
            var mine = await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None);
            Assert.False(Assert.Single(mine.Requests).Announce);
            Assert.False(_signal.Work.TryRead(out _));
        }

        // Nor does a wake for the user, Seerr's webhook, or a pass before the wait is over, send it any sooner.
        await _job.RunAsync(new ReadyPushWork(_alice), CancellationToken.None);
        await _job.RunAsync(new ReadyPushWork(null, 4), CancellationToken.None);
        await Pass();
        await Pass(discover: true);
        Assert.Single(_attempts);

        PushServiceAnswers(PushOutcome.Sent);
        _time.Advance(ReadyPushTimings.Default.RetryDelay);
        await Pass();
        Assert.Single(_sent);
        Assert.Equal(2, _attempts.Count);
        Assert.Equal(0, _job.Owed);

        // Told: nothing more, and never the pop-up.
        _time.Advance(TimeSpan.FromMinutes(30));
        await Pass(discover: true);
        Assert.Equal(2, _attempts.Count);
        Assert.False(Assert.Single((await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None)).Requests).Announce);
    }

    [Fact]
    public async Task APushServiceThatKeepsFailing_IsTriedThreeTimes_EachWaitTwiceTheLast_ThenTheRequestIsThePopUps()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers(PushOutcome.Failed);
        var start = _time.GetUtcNow();
        var attemptedAt = new List<TimeSpan>();

        // A pass every two minutes for half an hour, with the job woken between them.
        for (var minute = 0; minute <= 30; minute += 2)
        {
            var before = _attempts.Count;
            await Pass(discover: minute % 30 == 0);
            if (_attempts.Count > before)
            {
                attemptedAt.Add(_time.GetUtcNow() - start);
            }

            await _job.RunAsync(new ReadyPushWork(_alice), CancellationToken.None);
            _time.Advance(TimeSpan.FromMinutes(2));
        }

        // The first try, one a pass later, one two passes after that: then the job gives up, for good.
        Assert.Equal([TimeSpan.Zero, TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(6)], attemptedAt);
        Assert.Equal(ReadyPushJob.MaxAttempts, _attempts.Count);
        Assert.Equal(0, _job.Owed);
        Assert.Empty(_sent);

        // The device is still subscribed, so its user still "has notifications on": but this request is the pop-up's
        // now, and the page showing it doesn't wake the job to try yet again.
        Assert.True(_subscriptions.HasAny(_alice));
        var mine = await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None);
        Assert.True(Assert.Single(mine.Requests).Announce);
        Assert.False(_signal.Work.TryRead(out _));

        // One warning for the device, not one per attempt.
        Assert.Single(_senderLog.Entries, e => e.Level == Microsoft.Extensions.Logging.LogLevel.Warning);

        // Shown: never again, by anyone, even once the push service is back.
        _announcements.MarkAnnounced(_alice, Endpoint.BaseUrl.ToString(), [4]);
        PushServiceAnswers(PushOutcome.Sent);
        NextAnswer();
        await Pass(discover: true);
        await _job.RunAsync(new ReadyPushWork(null, 4), CancellationToken.None);
        Assert.Empty(_sent);
        Assert.False(Assert.Single((await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None)).Requests).Announce);
    }

    [Fact]
    public async Task WhatTheJobGaveUpOn_IsNeverPushedLate_EvenBeforeItsPopUpShows()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers(PushOutcome.Failed);
        await Pass();
        _time.Advance(TimeSpan.FromMinutes(2));
        await Pass();
        _time.Advance(TimeSpan.FromMinutes(4));
        await Pass();
        Assert.Equal(3, _attempts.Count);

        // The push service is back, and nobody has opened Lumen yet: the request waits for the pop-up, as it was left.
        PushServiceAnswers(PushOutcome.Sent);
        _time.Advance(TimeSpan.FromHours(1));
        await Pass(discover: true);
        await _job.RunAsync(new ReadyPushWork(_alice), CancellationToken.None);
        Assert.Empty(_sent);

        // The user's next request is pushed as ever.
        _announcements.Watch(_alice, Endpoint.BaseUrl.ToString(), [5]);
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 4, tmdbId: 603), Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 5, tmdbId: 605));
        NextAnswer();
        await Pass();
        Assert.Equal("Title 605 is ready to watch", Assert.Single(_sent).Message.GetProperty("title").GetString());
    }

    [Fact]
    public async Task APassThatRunsLate_StillGivesUpTenMinutesAfterTheFirstTry()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers(PushOutcome.Failed);
        await Pass();

        _time.Advance(ReadyPushJob.GiveUpAfter);
        await Pass();

        // The second attempt was the last: it's been ten minutes.
        Assert.Equal(2, _attempts.Count);
        Assert.Equal(0, _job.Owed);
        Assert.True(Assert.Single((await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None)).Requests).Announce);
    }

    [Fact]
    public async Task WithTwoDevices_OneTakingIt_DoesntEndTheOthersRetries_AndTheRequestCountsAsTold()
    {
        Subscribe(_alice, "phone");
        Subscribe(_alice, "laptop");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers("laptop", PushOutcome.Failed); // the phone's push service answers 201, the laptop's 503

        await Pass();
        Assert.Equal("phone", Assert.Single(_sent).Device);
        Assert.Equal(["laptop", "phone"], _attempts.Order());
        Assert.Equal(1, _job.Owed);

        // The laptop alone is sent it again, a pass later: the phone isn't told twice.
        _time.Advance(TimeSpan.FromMinutes(2));
        await Pass();
        Assert.Equal(["laptop", "laptop", "phone"], _attempts.Order());

        // Its push service is back for the third try.
        PushServiceAnswers("laptop", PushOutcome.Sent);
        _time.Advance(TimeSpan.FromMinutes(4));
        await Pass();
        Assert.Equal(["laptop", "phone"], _sent.Select(s => s.Device).Order());
        Assert.Equal(4, _attempts.Count);
        Assert.Equal(0, _job.Owed);

        _time.Advance(TimeSpan.FromMinutes(30));
        await Pass(discover: true);
        Assert.Equal(4, _attempts.Count);
    }

    [Fact]
    public async Task WithTwoDevices_OneNeverReached_IsGivenUpOn_ButNoPopUp_AsTheUserWasTold()
    {
        Subscribe(_alice, "phone");
        Subscribe(_alice, "laptop");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers("laptop", PushOutcome.Failed);

        await Pass();
        _time.Advance(TimeSpan.FromMinutes(2));
        await Pass();
        _time.Advance(TimeSpan.FromMinutes(4));
        await Pass();
        _time.Advance(TimeSpan.FromMinutes(8));
        await Pass();

        // Three tries for the laptop, one for the phone, and that's all.
        Assert.Equal(3, _attempts.Count(d => d == "laptop"));
        Assert.Equal(1, _attempts.Count(d => d == "phone"));
        Assert.Equal(0, _job.Owed);

        // The phone told its user: the request isn't given back, to the pop-up or to another push.
        var mine = await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None);
        Assert.False(Assert.Single(mine.Requests).Announce);
        Assert.Empty(_announcements.PopUpOnly(_alice, Endpoint.BaseUrl.ToString()));
        Assert.True(_subscriptions.ForDevice(_alice, "laptop") is not null);
    }

    [Fact]
    public async Task ADeviceThePushServiceKeepsRefusing_IsRemovedAtItsThirdTry_AndThePopUpTakesOver()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers(PushOutcome.Rejected);

        await Pass();
        _time.Advance(TimeSpan.FromMinutes(2));
        await Pass();
        Assert.True(_subscriptions.HasAny(_alice));
        _time.Advance(TimeSpan.FromMinutes(4));
        await Pass();

        Assert.Equal(3, _attempts.Count);
        Assert.False(_subscriptions.HasAny(_alice));
        Assert.True(Assert.Single((await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None)).Requests).Announce);
    }

    [Fact]
    public async Task ADeviceTurnedOffWhileItsOwedAPush_IsOwedNothing_AndThePopUpTakesOver()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers(PushOutcome.Failed);
        await Pass();

        _subscriptions.Remove(_alice, "phone");
        _time.Advance(TimeSpan.FromMinutes(2));
        await Pass();

        Assert.Single(_attempts);
        Assert.Equal(0, _job.Owed);
        Assert.True(Assert.Single((await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None)).Requests).Announce);
    }

    [Fact]
    public async Task ADeviceTurnedOnWhileAnotherIsOwedAPush_GetsItOnceTheOtherIsGone()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers(PushOutcome.Failed);
        await Pass();

        // The phone's subscription is replaced by a laptop's before anyone was told.
        _subscriptions.Remove(_alice, "phone");
        Subscribe(_alice, "laptop");
        PushServiceAnswers(PushOutcome.Sent);
        _time.Advance(TimeSpan.FromMinutes(2));
        await Pass();

        // The request was given back, and the same pass (or the next check) pushes it to the device there is now.
        NextAnswer();
        await Pass();
        Assert.Equal("laptop", Assert.Single(_sent).Device);
    }

    [Fact]
    public async Task EachRequest_HasItsOwnRetries()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, 1, 2);
        PushServiceAnswers(PushOutcome.Failed);
        await Pass();
        Assert.Equal(2, _job.Owed);
        Assert.Equal(2, _attempts.Count);

        // Still one warning for the one device, though two notifications failed.
        Assert.Single(_senderLog.Entries, e => e.Level == Microsoft.Extensions.Logging.LogLevel.Warning);

        PushServiceAnswers(PushOutcome.Sent);
        _time.Advance(TimeSpan.FromMinutes(2));
        await Pass();
        Assert.Equal(["Title 601 is ready to watch", "Title 602 is ready to watch"], _sent.Select(s => s.Message.GetProperty("title").GetString()).Order());
        Assert.Equal(0, _job.Owed);
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
    public async Task ARequestThatDisappearsFromSeerr_StopsItsUserBeingAskedAboutEveryPass()
    {
        Subscribe(_alice, "phone");
        Requests(7, Downloading(id: 4));
        await Pass(discover: true);
        NextAnswer();
        await Pass();
        await AskedSeerr(7, times: 2);

        // Deleted in Seerr (or pushed out of the newest requests): this pass still asks, and learns it.
        Requests(7);
        NextAnswer();
        await Pass();
        await AskedSeerr(7, times: 3);

        // From then on there's nothing to ask about, pass after pass, until a discovery pass looks again.
        for (var i = 0; i < 5; i++)
        {
            NextAnswer();
            await Pass();
        }

        await AskedSeerr(7, times: 3);
        Assert.False(_announcements.ExpectsSoon(_alice));
        NextAnswer();
        await Pass(discover: true);
        await AskedSeerr(7, times: 4);
    }

    [Fact]
    public async Task ARequestRemovedFromTheServer_OrDeclined_StopsItToo()
    {
        Subscribe(_alice, "phone");
        Requests(7, Downloading(id: 4, tmdbId: 603), Downloading(id: 5, tmdbId: 604));
        await Pass(discover: true);

        // One's title was removed from the server again (Seerr calls that request Completed), the other was declined.
        Requests(7, Request(SeerrRequestStatus.Completed, mediaStatus: 7, id: 4, tmdbId: 603), Request(SeerrRequestStatus.Declined, id: 5, tmdbId: 604));
        NextAnswer();
        await Pass();
        await AskedSeerr(7, times: 2);

        NextAnswer();
        await Pass();
        await AskedSeerr(7, times: 2);
        Assert.Empty(_sent);
    }

    [Fact]
    public async Task AUserWhoseRequestsOnlyWait_IsAskedAboutEveryHalfHour_NotEveryPass()
    {
        Subscribe(_alice, "phone");

        // Waiting for an admin's approval since four days, and approved but unreleased since six.
        Requests(7, Request(SeerrRequestStatus.Pending, id: 4, tmdbId: 603), Request(id: 6, tmdbId: 606));
        await Pass(discover: true);
        await AskedSeerr(7, times: 1);

        for (var pass = 1; pass < ReadyPushJob.DiscoverEvery; pass++)
        {
            NextAnswer();
            await Pass();
        }

        await AskedSeerr(7, times: 1);
        NextAnswer();
        await Pass(discover: true);
        await AskedSeerr(7, times: 2);

        // Approved and downloading: back to every pass.
        Requests(7, Downloading(id: 4, tmdbId: 603), Request(id: 6, tmdbId: 606));
        NextAnswer();
        await Pass(discover: true);
        NextAnswer();
        await Pass();
        await AskedSeerr(7, times: 4);

        // And one that was only waiting is still announced when it's ready, at the half-hourly look.
        Requests(7, Downloading(id: 4, tmdbId: 603), Request(SeerrRequestStatus.Completed, mediaStatus: 5, id: 6, tmdbId: 606));
        NextAnswer();
        await Pass();
        Assert.Equal("Title 606 is ready to watch", Assert.Single(_sent).Message.GetProperty("title").GetString());
    }

    [Fact]
    public async Task ARequestOnlyJustFiled_IsAskedAboutEveryPass_WaitingOrNot()
    {
        Subscribe(_alice, "phone");
        Requests(7, new SeerrUserRequest
        {
            Id = 4,
            Status = SeerrRequestStatus.Approved,
            Type = "movie",
            CreatedAt = TestData.Now.AddHours(-3),
            Media = new SeerrRequestMedia { TmdbId = 603, MediaType = "movie", Status = 3, DownloadStatus = [] },
        });
        await Pass(discover: true);

        NextAnswer();
        await Pass();

        await AskedSeerr(7, times: 2);
    }

    [Fact]
    public async Task ADiscoveryPass_FindsRequestsFiledInSeerrItself_AndFollowsThemFromThen()
    {
        Subscribe(_alice, "phone");
        Requests(7, Downloading(id: 4)); // filed in Seerr: Lumen has never seen it

        await Pass();
        await _seerr.DidNotReceiveWithAnyArgs().GetUserRequestsAsync(default!, default, default);

        await Pass(discover: true);
        Assert.True(_announcements.ExpectsSoon(_alice));

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
        Subscribe(_alice, "phone");
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
            CreatedAt = TestData.Now.AddHours(-id),
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
    public async Task AShowsReadySeason_StaysWatched_WhileAnotherIsInFlight_AndIsAnnouncedIfThatOneIsWithdrawn()
    {
        Subscribe(_alice, "phone");
        SeerrUserRequest Season(int id, int season, int status, int mediaStatus) => new()
        {
            Id = id,
            Status = status,
            Type = "tv",
            CreatedAt = TestData.Now.AddHours(-id),
            Seasons = [new SeerrSeasonStatus { SeasonNumber = season }],
            Media = new SeerrRequestMedia { TmdbId = 1399, MediaType = "tv", Status = mediaStatus, DownloadStatus = [] },
        };
        _seerr.GetTitleSummaryAsync(default!, default, default!, default, default).ReturnsForAnyArgs(new SeerrTitle { Id = 1399, Name = "Lumen Saga" });
        _announcements.Update(_alice, Endpoint.BaseUrl.ToString(), [1, 2], [], []);

        // Season 1 is ready but not announced yet: forgetting it here, as a request that's no longer in flight, would
        // leave nothing to announce once season 2 is out of the way.
        Requests(7, Season(1, 1, SeerrRequestStatus.Completed, 4), Season(2, 2, SeerrRequestStatus.Approved, 4));
        await Pass();
        Assert.Empty(_sent);

        // Season 2's request is deleted in Seerr: all that's left of the show is ready.
        NextAnswer();
        Requests(7, Season(1, 1, SeerrRequestStatus.Completed, 4));
        await Pass();
        Assert.Equal("Lumen Saga is ready to watch", Assert.Single(_sent).Message.GetProperty("title").GetString());
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
        Assert.True(_announcements.ExpectsSoon(_alice));
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

    [Fact]
    public async Task WithTheTestServersTimings_TheWaitsAreItsOwn_AndStillNoWakeShortensThem()
    {
        // As on the E2E tests' server: a pass an hour, a failed send tried again after five seconds, then ten.
        var job = Job(new ReadyPushTimings(TimeSpan.FromHours(1), TimeSpan.FromSeconds(5)));
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers(PushOutcome.Failed);
        await job.RunPassAsync(false, CancellationToken.None);
        Assert.Single(_attempts);

        async Task Nudge()
        {
            await job.RunAsync(new ReadyPushWork(_alice), CancellationToken.None);
            await job.RunAsync(new ReadyPushWork(null, 4), CancellationToken.None);
            await job.RetryAsync(CancellationToken.None);
        }

        _time.Advance(TimeSpan.FromSeconds(4));
        await Nudge();
        Assert.Single(_attempts);
        _time.Advance(TimeSpan.FromSeconds(1));
        await Nudge();
        Assert.Equal(2, _attempts.Count);

        _time.Advance(TimeSpan.FromSeconds(9));
        await Nudge();
        Assert.Equal(2, _attempts.Count);
        _time.Advance(TimeSpan.FromSeconds(1));
        await Nudge();
        Assert.Equal(3, _attempts.Count);

        Assert.Equal(0, job.Owed);
        Assert.Equal([4], _announcements.PopUpOnly(_alice, Endpoint.BaseUrl.ToString()));
    }

    [Fact]
    public async Task TheJob_SendsWhatsOwedAgain_WhenItsWaitIsOver_WithoutWaitingForAPass()
    {
        var job = Job(new ReadyPushTimings(TimeSpan.FromHours(1), TimeSpan.FromSeconds(5)));
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers(PushOutcome.Failed);
        _signal.Running = false;

        await job.StartAsync(CancellationToken.None);
        await WaitFor(() => _attempts.Count == 1);
        var first = _time.GetUtcNow();

        // Its own loop sends it again, twice, then gives up: all long before the next pass, an hour away.
        await WaitFor(() => _attempts.Count == 3 && job.Owed == 0);
        Assert.InRange(_time.GetUtcNow() - first, TimeSpan.Zero, TimeSpan.FromMinutes(10));
        Assert.Equal([4], _announcements.PopUpOnly(_alice, Endpoint.BaseUrl.ToString()));

        // And then no more.
        for (var i = 0; i < 60; i++)
        {
            _time.Advance(TimeSpan.FromSeconds(1));
            await Task.Delay(5);
        }

        Assert.Equal(3, _attempts.Count);
        await job.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task WhenTheJobStops_WhatsStillOwed_IsGivenBack_ForThePopUpOrTheNextStart()
    {
        Subscribe(_alice, "phone");
        await SeenInFlightThenReady(7, id: 4);
        PushServiceAnswers(PushOutcome.Failed);
        _signal.Running = false;
        await _job.StartAsync(CancellationToken.None);
        await WaitFor(() => _attempts.Count == 1);

        await _job.StopAsync(CancellationToken.None);

        // Nobody was told and nobody will retry: the pop-up shows it (the job isn't running), and a job started after
        // the restart pushes it, as nothing was left to the pop-up alone.
        Assert.Equal(0, _job.Owed);
        var mine = await _progress.GetAsync(_alice, TestData.User(), Endpoint, 7, CancellationToken.None);
        Assert.True(Assert.Single(mine.Requests).Announce);
        Assert.Empty(_announcements.PopUpOnly(_alice, Endpoint.BaseUrl.ToString()));

        PushServiceAnswers(PushOutcome.Sent);
        _signal.Running = true;
        await Job(ReadyPushTimings.Default).RunPassAsync(false, CancellationToken.None);
        Assert.Single(_sent);
    }

    /// <summary>A request that's downloading: in flight, and expected to be ready soon however long ago it was filed.</summary>
    private static SeerrUserRequest Downloading(int id, int tmdbId = 603) =>
        Request(downloads: [Download(1000, 500, "downloading")], id: id, tmdbId: tmdbId);

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

    private void Subscribe(Guid user, string device) =>
        _subscriptions.Save(user, Subscription(device, "https://web.push.apple.com/" + device));

    private ReadyPushJob Job(ReadyPushTimings timings)
    {
        var job = new ReadyPushJob(_signal, _subscriptions, _announcements, _users, _progress, _sender, Substitute.For<IUserManager>(), _time, timings, NullLogger<ReadyPushJob>.Instance);
        _jobs.Add(job);
        return job;
    }

    private async Task AskedSeerr(int seerrUserId, int times) =>
        await _seerr.Received(times).GetUserRequestsAsync(Endpoint, seerrUserId, Arg.Any<CancellationToken>(), Arg.Any<int>());

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

    private void PushServiceAnswers(string device, PushOutcome outcome)
    {
        lock (_sent)
        {
            _outcomes[device] = outcome;
        }
    }
}
