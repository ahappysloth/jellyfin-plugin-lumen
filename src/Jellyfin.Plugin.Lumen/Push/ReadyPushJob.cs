using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>
/// Sends "ready to watch" notifications, with the app closed (web push design note, 2026-11-12). Seerr can't push to
/// Lumen by itself, so this asks it, but only on behalf of users who turned notifications on in some device:
/// <list type="bullet">
/// <item>every pass (<see cref="ReadyPushTimings.Interval"/>, two minutes), those with a request Lumen is watching that
/// may be ready any time (<see cref="IReadyAnnouncements.ExpectsSoon"/>: seen in flight, or filed through Lumen);</item>
/// <item>every <see cref="DiscoverEvery"/>th pass, the others too: to find requests they filed in Seerr itself, and to
/// look in on those that have only been waiting, for an approval or a release, for over a day;</item>
/// <item>at once, a user whose open page found a ready request (<see cref="IReadyPushSignal.Wake"/>), or everyone when
/// Seerr's webhook says something became available.</item>
/// </list>
/// Each check is the same cached, shared Seerr call the request list makes (<see cref="IRequestProgressService"/>): one
/// per user per pass at most, through Seerr's circuit breaker. A request is taken before it's sent
/// (<see cref="IRequestProgressService.ClaimReadyAsync"/>), so it's announced once, and never by the pop-up as well.
/// <para>
/// Each device is owed the notification on its own: one that took it has it, and one whose push service failed is
/// sent it again, <see cref="MaxAttempts"/> times in all, each wait twice the last and none shorter than
/// <see cref="ReadyPushTimings.RetryDelay"/>, however often the job is woken meanwhile, and never later than
/// <see cref="GiveUpAfter"/> after the first. One whose push service refused the message isn't sent the same one
/// again. A send that throws, rather than say how it went, is a failed attempt like any other. The request stays taken
/// while that goes on, so an open page neither shows the pop-up nor wakes the job for it. Then the job gives up: if no
/// device got it, the request is left to the pop-up (<see cref="IRequestProgressService.Release"/>), so its user hears
/// of it the next time Lumen is open. What's still owed when Jellyfin stops is given back, to be sent after the
/// restart; and if Jellyfin is killed instead, the announcement list does the same when it's next read
/// (<see cref="ReadyAnnouncements"/>), as it's told when a device got a push (<see cref="IRequestProgressService.Delivered"/>).
/// </para>
/// </summary>
public sealed class ReadyPushJob : BackgroundService
{
    /// <summary>Every 15th pass (half an hour) also checks users with nothing expected soon.</summary>
    public const int DiscoverEvery = 15;

    /// <summary>How often a device is sent one notification before the job gives up on it: the first try and two more.</summary>
    public const int MaxAttempts = 3;

    /// <summary>However few attempts were made (passes can run late), nothing is tried again this long after the first.</summary>
    public static readonly TimeSpan GiveUpAfter = TimeSpan.FromMinutes(10);

    /// <summary>How long a push service keeps a "ready" notification for a device that's off: it's still news days later.</summary>
    public static readonly TimeSpan ReadyTimeToLive = TimeSpan.FromDays(3);

    /// <summary>After Jellyfin starts, before the first pass: Seerr may be starting too.</summary>
    private static readonly TimeSpan StartDelay = TimeSpan.FromSeconds(30);

    /// <summary>Notifications some device hasn't got yet. Only the job's own loop touches it.</summary>
    private readonly List<Delivery> _owed = [];
    private readonly ReadyPushSignal _signal;
    private readonly IPushSubscriptionStore _subscriptions;
    private readonly IReadyAnnouncements _announcements;
    private readonly ISeerrUserMap _users;
    private readonly IRequestProgressService _progress;
    private readonly IPushSender _sender;
    private readonly IUserManager _userManager;
    private readonly TimeProvider _time;
    private readonly ReadyPushTimings _timings;
    private readonly ILogger<ReadyPushJob> _logger;

    public ReadyPushJob(
        ReadyPushSignal signal,
        IPushSubscriptionStore subscriptions,
        IReadyAnnouncements announcements,
        ISeerrUserMap users,
        IRequestProgressService progress,
        IPushSender sender,
        IUserManager userManager,
        TimeProvider time,
        ReadyPushTimings timings,
        ILogger<ReadyPushJob> logger)
    {
        _signal = signal;
        _subscriptions = subscriptions;
        _announcements = announcements;
        _users = users;
        _progress = progress;
        _sender = sender;
        _userManager = userManager;
        _time = time;
        _timings = timings;
        _logger = logger;
    }

    /// <summary>Gets how many notifications some device is still owed (for tests).</summary>
    internal int Owed => _owed.Count;

    /// <summary>
    /// The variables meant for the E2E tests' server that are in force here, each with what it does: empty on a real
    /// server. <paramref name="testEndpoint"/> is <see cref="PushSubscription.TestEndpointVariable"/>'s value.
    /// </summary>
    internal static IReadOnlyList<string> TestOverrides(ReadyPushTimings timings, string? testEndpoint)
    {
        var overrides = new List<string>();
        if (timings.Interval != ReadyPushTimings.Default.Interval)
        {
            overrides.Add(FormattableString.Invariant($"{ReadyPushTimings.TestPassVariable} (requests are checked every {timings.Interval.TotalSeconds:0.#} s)"));
        }

        if (timings.RetryDelay != ReadyPushTimings.Default.RetryDelay)
        {
            overrides.Add(FormattableString.Invariant($"{ReadyPushTimings.TestRetryVariable} (a failed send is tried again after {timings.RetryDelay.TotalSeconds:0.#} s)"));
        }

        if (!string.IsNullOrWhiteSpace(testEndpoint))
        {
            overrides.Add(PushSubscription.TestEndpointVariable + " (push addresses under it are taken, over http too)");
        }

        return overrides;
    }

    /// <summary>
    /// One regular pass: what's owed and due again, then every user with notifications on and a request that may be
    /// ready any time, or every user with notifications on when <paramref name="discover"/>.
    /// </summary>
    internal async Task RunPassAsync(bool discover, CancellationToken cancellationToken)
    {
        await RetryAsync(cancellationToken).ConfigureAwait(false);
        foreach (var userId in _subscriptions.Users())
        {
            if (discover || _announcements.ExpectsSoon(userId))
            {
                await CheckUserAsync(userId, null, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    /// <summary>
    /// Sends what's owed again to the devices that didn't get it, where the wait since their last attempt is over. Never
    /// throws but for cancellation.
    /// </summary>
    internal async Task RetryAsync(CancellationToken cancellationToken)
    {
        var now = _time.GetUtcNow();
        foreach (var delivery in _owed.Where(d => d.Next <= now).ToList())
        {
            // Looked at before sending, not after: a pass that ran late, or a host back from sleep, sends nothing more.
            if (now - delivery.First >= GiveUpAfter)
            {
                Close(delivery, true);
                continue;
            }

            try
            {
                await AttemptAsync(delivery, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception e) when (e is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                // An attempt answers for what its sender throws, so this is a fault of the job's own. Dropped, not left
                // owed and due: the job's loop would come straight back for it.
                _owed.Remove(delivery);
                _logger.LogError(e, "Lumen couldn't send a notification again");
            }
        }
    }

    /// <summary>Work asked for between passes: one user, or everyone (Seerr's webhook).</summary>
    internal async Task RunAsync(ReadyPushWork work, CancellationToken cancellationToken)
    {
        IReadOnlyCollection<int>? alsoWatch = work.RequestId is { } id ? [id] : null;
        foreach (var userId in work.UserId is { } one ? [one] : _subscriptions.Users())
        {
            await CheckUserAsync(userId, alsoWatch, cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>Asks Seerr about one user's requests and notifies them of what became ready. Never throws but for cancellation.</summary>
    internal async Task CheckUserAsync(Guid userId, IReadOnlyCollection<int>? alsoWatch, CancellationToken cancellationToken)
    {
        if (!_subscriptions.HasAny(userId))
        {
            return;
        }

        try
        {
            // No access: Lumen or requests are off, the user has no Seerr account, or Seerr is known to be down.
            var access = await _users.GetAccessAsync(userId, cancellationToken).ConfigureAwait(false);
            if (!access.Enabled || access.SeerrUserId is not { } seerrUserId || access.Endpoint is not { } endpoint)
            {
                return;
            }

            var ready = await _progress.ClaimReadyAsync(userId, _userManager.GetUserById(userId), endpoint, seerrUserId, alsoWatch, cancellationToken).ConfigureAwait(false);
            if (ready.Count == 0)
            {
                return;
            }

            // Taken, and not a notification's yet. Whatever ends this early (Jellyfin stopping after the first of three
            // titles, say), what's left here is due again: taken and never sent, nobody would announce it.
            var taken = ready.SelectMany(r => r.RequestIds).ToList();
            try
            {
                // A title Seerr couldn't name in time waits for the next pass rather than going out as "something is
                // ready" (given back below, with whatever else is left).
                var named = ready.Where(r => r.Item is not null).ToList();
                if (named.Count > PushMessage.MaxSeparate)
                {
                    var message = PushMessage.ReadyMany(named.Select(r => r.Item!).ToList());
                    var all = named.SelectMany(r => r.RequestIds).ToList();
                    taken.RemoveAll(all.Contains);
                    await SendAsync(userId, endpoint, all, message, cancellationToken).ConfigureAwait(false);
                    return;
                }

                var imageToken = CatalogImageToken.Create(userId, endpoint.ApiKey);
                foreach (var title in named)
                {
                    var message = PushMessage.Ready(title.Item!, imageToken);
                    taken.RemoveAll(title.RequestIds.Contains);
                    await SendAsync(userId, endpoint, title.RequestIds, message, cancellationToken).ConfigureAwait(false);
                }
            }
            finally
            {
                if (taken.Count > 0)
                {
                    _progress.GiveBack(userId, endpoint, taken);
                }
            }
        }
        catch (SeerrException e)
        {
            // Seerr's client and its circuit breaker have logged an outage once; this is every pass.
            if (_logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug("Lumen couldn't check a user's requests for notifications: {Message}", e.LogText);
            }
        }
        catch (Exception e) when (e is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            _logger.LogError(e, "Lumen's notification check failed for a user");
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // Said once, at startup: left set on a real server, they'd go unnoticed (a pass an hour, say) for ever.
            var overrides = TestOverrides(_timings, Environment.GetEnvironmentVariable(PushSubscription.TestEndpointVariable));
            if (overrides.Count > 0)
            {
                _logger.LogWarning(
                    "Lumen's notifications run with settings that are for its own tests' server only: {Overrides}. Unset them on a real server.",
                    string.Join("; ", overrides));
            }

            _signal.Running = true;
            await Task.Delay(StartDelay, _time, stoppingToken).ConfigureAwait(false);
            var pass = 0;
            var nextPass = _time.GetUtcNow();
            while (!stoppingToken.IsCancellationRequested)
            {
                var now = _time.GetUtcNow();
                if (nextPass <= now)
                {
                    // The first pass, and then every DiscoverEvery-th, looks at everyone with notifications on.
                    await RunPassAsync(pass % DiscoverEvery == 0, stoppingToken).ConfigureAwait(false);
                    pass++;
                    nextPass = _time.GetUtcNow() + _timings.Interval;
                    continue;
                }

                // What's owed is sent again when its own wait is over, between passes too, and never because of a wake.
                var until = nextPass;
                if (_owed.Count > 0 && _owed.Min(d => d.Next) is var retry && retry < until)
                {
                    if (retry <= now)
                    {
                        await RetryAsync(stoppingToken).ConfigureAwait(false);
                        continue;
                    }

                    until = retry;
                }

                using var woken = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                var tick = Task.Delay(until - now, _time, woken.Token);
                var work = _signal.Work.WaitToReadAsync(woken.Token).AsTask();
                await Task.WhenAny(tick, work).ConfigureAwait(false);
                await woken.CancelAsync().ConfigureAwait(false);
                stoppingToken.ThrowIfCancellationRequested();
                while (_signal.Work.TryRead(out var item))
                {
                    await RunAsync(item, stoppingToken).ConfigureAwait(false);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Jellyfin is shutting down.
        }
        finally
        {
            // Nobody sends pushes any more. What no device got yet is due again: for the pop-up, which is back for
            // everyone, or for the push after a restart.
            foreach (var delivery in _owed.ToList())
            {
                Close(delivery, false);
            }

            _signal.Running = false;
        }
    }

    /// <summary>The first attempt at a notification, to every device the user has notifications on in.</summary>
    private Task SendAsync(Guid userId, SeerrEndpoint endpoint, IEnumerable<int> requestIds, PushMessage message, CancellationToken cancellationToken)
    {
        var delivery = new Delivery(userId, endpoint, requestIds.ToList(), message, _time.GetUtcNow());

        // Ready again (it went back in flight) while its last notification is still owed to a device: that one no longer
        // answers for these requests, this one does.
        foreach (var earlier in _owed.Where(d => d.UserId == userId).ToList())
        {
            earlier.RequestIds.RemoveAll(delivery.RequestIds.Contains);
            if (earlier.RequestIds.Count == 0)
            {
                _owed.Remove(earlier);
            }
        }

        return AttemptAsync(delivery, cancellationToken);
    }

    /// <summary>
    /// One attempt: to every device (the first), or to those that still haven't got it. Then the notification is done
    /// with, or owed for another attempt, or given up on. Never throws but for cancellation.
    /// </summary>
    private async Task AttemptAsync(Delivery delivery, CancellationToken cancellationToken)
    {
        var now = _time.GetUtcNow();
        try
        {
            var result = await _sender.SendAsync(delivery.UserId, delivery.Message, ReadyTimeToLive, cancellationToken, delivery.Devices).ConfigureAwait(false);
            delivery.Devices = result.Devices.Where(d => d.Owed).Select(d => d.DeviceId).ToList();
            delivery.Refused |= result.Devices.Any(d => d.Refused);
            if (result.Delivered && !delivery.Told)
            {
                // Written down now, not when the last device is done with: if Jellyfin is killed while another device is
                // still being tried, the request isn't announced again to the one that has it.
                delivery.Told = true;
                _progress.Delivered(delivery.UserId, delivery.Endpoint, delivery.RequestIds);
            }
        }
        catch (Exception e) when (e is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            // The sender couldn't say how it went (a push service that fails is an answer, not this: Jellyfin's device
            // list or Lumen's own files, say). Nobody is known to have got it, so it's a failed attempt for every device
            // it was for: given back instead, it would be taken and sent again at every pass, and at the rate an open
            // page asks, for as long as it lasts, and never reach the pop-up.
            if (!delivery.Faulted)
            {
                delivery.Faulted = true;
                _logger.LogError(e, "Lumen couldn't send a notification. It tries a few more times, then leaves what's ready to the pop-up in the app.");
            }
        }
        catch
        {
            // Jellyfin is stopping: nobody was told, and nobody will try again.
            Close(delivery, false);
            throw;
        }

        delivery.Attempts++;
        var wait = _timings.RetryDelay * (1 << (delivery.Attempts - 1));
        if (delivery.Devices is { Count: 0 })
        {
            // Nothing more to send: every device has it, is gone, or refused it. If none got it, it's due again: to
            // whoever asks next when the user has no device left, but to the pop-up alone if one refused and is still
            // there, or the next pass would take the request and send that device the same message again.
            Close(delivery, delivery.Refused);
        }
        else if (delivery.Attempts >= MaxAttempts || now + wait - delivery.First >= GiveUpAfter)
        {
            // A push service that's been failing for minutes may for hours (PushSender has logged it, once), and a try
            // that would come later than GiveUpAfter is never made, so there's nothing to wait for.
            Close(delivery, true);
        }
        else
        {
            delivery.Next = now + wait;
            if (!_owed.Contains(delivery))
            {
                _owed.Add(delivery);
            }
        }
    }

    /// <summary>
    /// Nothing more is sent for this notification. If no device took it, its requests are due again: to the pop-up
    /// alone when the job has given up on devices that are still there (<paramref name="giveUp"/>), else to whoever
    /// asks next.
    /// </summary>
    private void Close(Delivery delivery, bool giveUp)
    {
        _owed.Remove(delivery);
        if (delivery.Told || delivery.RequestIds.Count == 0)
        {
            return;
        }

        if (giveUp)
        {
            _progress.Release(delivery.UserId, delivery.Endpoint, delivery.RequestIds);
        }
        else
        {
            _progress.GiveBack(delivery.UserId, delivery.Endpoint, delivery.RequestIds);
        }
    }

    /// <summary>One notification about a user's requests, and which devices still haven't got it.</summary>
    private sealed class Delivery(Guid userId, SeerrEndpoint endpoint, List<int> requestIds, PushMessage message, DateTimeOffset first)
    {
        public Guid UserId { get; } = userId;

        public SeerrEndpoint Endpoint { get; } = endpoint;

        public List<int> RequestIds { get; } = requestIds;

        public PushMessage Message { get; } = message;

        /// <summary>Gets when it was first sent.</summary>
        public DateTimeOffset First { get; } = first;

        /// <summary>Gets or sets the devices to send to: null for all of the user's (the first attempt), then those that didn't get it.</summary>
        public List<string>? Devices { get; set; }

        /// <summary>Gets or sets a value indicating whether some device took it: its user has been told.</summary>
        public bool Told { get; set; }

        /// <summary>Gets or sets a value indicating whether a device that's still subscribed had it refused by its push service.</summary>
        public bool Refused { get; set; }

        /// <summary>Gets or sets a value indicating whether an attempt threw: logged for the first, not for each.</summary>
        public bool Faulted { get; set; }

        public int Attempts { get; set; }

        /// <summary>Gets or sets when it may be sent again.</summary>
        public DateTimeOffset Next { get; set; }
    }
}
