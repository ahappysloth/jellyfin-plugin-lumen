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
/// Each device is owed the notification on its own: one that took it has it, and one whose push service failed (or
/// refused) is sent it again, <see cref="MaxAttempts"/> times in all, each wait twice the last and none shorter than
/// <see cref="ReadyPushTimings.RetryDelay"/>, however often the job is woken meanwhile. The request stays taken while
/// that goes on, so an open page neither shows the pop-up nor wakes the job for it. Then the job gives up: if no device
/// got it, the request is left to the pop-up (<see cref="IRequestProgressService.Release"/>), so its user hears of it
/// the next time Lumen is open. What's still owed when Jellyfin stops is given back, to be sent after the restart.
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
            try
            {
                await AttemptAsync(delivery, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception e) when (e is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
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

            // A title Seerr couldn't name in time waits for the next pass rather than going out as "something is ready".
            _progress.GiveBack(userId, endpoint, ready.Where(r => r.Item is null).SelectMany(r => r.RequestIds));
            var named = ready.Where(r => r.Item is not null).ToList();
            if (named.Count == 0)
            {
                return;
            }

            var imageToken = CatalogImageToken.Create(userId, endpoint.ApiKey);
            if (named.Count > PushMessage.MaxSeparate)
            {
                await SendAsync(userId, endpoint, named.SelectMany(r => r.RequestIds), PushMessage.ReadyMany(named.Select(r => r.Item!).ToList()), cancellationToken).ConfigureAwait(false);
                return;
            }

            foreach (var title in named)
            {
                await SendAsync(userId, endpoint, title.RequestIds, PushMessage.Ready(title.Item!, imageToken), cancellationToken).ConfigureAwait(false);
            }
        }
        catch (SeerrException e)
        {
            // Seerr's client and its circuit breaker have logged an outage once; this is every pass.
            if (_logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug("Lumen couldn't check a user's requests for notifications: {Message}", e.Message);
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
    /// with, or owed for another attempt, or given up on.
    /// </summary>
    private async Task AttemptAsync(Delivery delivery, CancellationToken cancellationToken)
    {
        var now = _time.GetUtcNow();
        PushSendResult result;
        try
        {
            result = await _sender.SendAsync(delivery.UserId, delivery.Message, ReadyTimeToLive, cancellationToken, delivery.Devices).ConfigureAwait(false);
        }
        catch
        {
            Close(delivery, false);
            throw;
        }

        delivery.Attempts++;
        delivery.Told |= result.Delivered;
        delivery.Devices = result.Devices.Where(d => d.Owed).Select(d => d.DeviceId).ToList();
        if (delivery.Devices.Count == 0)
        {
            // Every device has it or is gone. If none got it, it's due again: for the pop-up, with no device left.
            Close(delivery, false);
        }
        else if (delivery.Attempts >= MaxAttempts || now - delivery.First >= GiveUpAfter)
        {
            // A push service that's been failing for minutes may for hours. PushSender has logged it, once.
            Close(delivery, true);
        }
        else
        {
            delivery.Next = now + (_timings.RetryDelay * (1 << (delivery.Attempts - 1)));
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

        public int Attempts { get; set; }

        /// <summary>Gets or sets when it may be sent again.</summary>
        public DateTimeOffset Next { get; set; }
    }
}
