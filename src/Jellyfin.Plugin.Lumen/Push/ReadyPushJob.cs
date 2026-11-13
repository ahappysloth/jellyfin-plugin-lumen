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
/// <item>every <see cref="Interval"/>, those with a request Lumen is watching (<see cref="IReadyAnnouncements"/>: seen in
/// flight, or filed through Lumen);</item>
/// <item>every <see cref="DiscoverEvery"/>th pass, the others too, to find requests they filed in Seerr itself;</item>
/// <item>at once, a user whose open page found a ready request (<see cref="IReadyPushSignal.Wake"/>), or everyone when
/// Seerr's webhook says something became available.</item>
/// </list>
/// Each check is the same cached, shared Seerr call the request list makes (<see cref="IRequestProgressService"/>): one
/// per user per pass at most, through Seerr's circuit breaker. A request is taken before it's sent
/// (<see cref="IRequestProgressService.ClaimReadyAsync"/>), so it's announced once, and never by the pop-up as well;
/// if no device could be reached it's given back, for the next pass (or for the pop-up, if no device is left).
/// </summary>
public sealed class ReadyPushJob : BackgroundService
{
    /// <summary>Every 15th pass (half an hour) also checks users with nothing known to be in flight.</summary>
    public const int DiscoverEvery = 15;

    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(2);

    /// <summary>How long a push service keeps a "ready" notification for a device that's off: it's still news days later.</summary>
    public static readonly TimeSpan ReadyTimeToLive = TimeSpan.FromDays(3);

    /// <summary>After Jellyfin starts, before the first pass: Seerr may be starting too.</summary>
    private static readonly TimeSpan StartDelay = TimeSpan.FromSeconds(30);

    private readonly ReadyPushSignal _signal;
    private readonly IPushSubscriptionStore _subscriptions;
    private readonly IReadyAnnouncements _announcements;
    private readonly ISeerrUserMap _users;
    private readonly IRequestProgressService _progress;
    private readonly IPushSender _sender;
    private readonly IUserManager _userManager;
    private readonly TimeProvider _time;
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
        _logger = logger;
    }

    /// <summary>
    /// One regular pass: every user with notifications on and a request being watched, or every user with notifications
    /// on when <paramref name="discover"/>.
    /// </summary>
    internal async Task RunPassAsync(bool discover, CancellationToken cancellationToken)
    {
        foreach (var userId in _subscriptions.Users())
        {
            if (discover || _announcements.IsWatching(userId))
            {
                await CheckUserAsync(userId, null, cancellationToken).ConfigureAwait(false);
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
                var items = named.Select(r => r.Item!).ToList();
                await SendAsync(userId, endpoint, named.SelectMany(r => r.RequestIds), device => PushMessage.ReadyMany(items, device.Locale), cancellationToken).ConfigureAwait(false);
                return;
            }

            foreach (var title in named)
            {
                await SendAsync(userId, endpoint, title.RequestIds, _ => PushMessage.Ready(title.Item!, imageToken), cancellationToken).ConfigureAwait(false);
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
                var wait = nextPass - _time.GetUtcNow();
                if (wait <= TimeSpan.Zero)
                {
                    // The first pass, and then every DiscoverEvery-th, looks at everyone with notifications on.
                    await RunPassAsync(pass % DiscoverEvery == 0, stoppingToken).ConfigureAwait(false);
                    pass++;
                    nextPass = _time.GetUtcNow() + Interval;
                    continue;
                }

                using var woken = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                var tick = Task.Delay(wait, _time, woken.Token);
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
            // Nobody sends pushes any more: the pop-up is back for everyone.
            _signal.Running = false;
        }
    }

    private async Task SendAsync(Guid userId, SeerrEndpoint endpoint, IEnumerable<int> requestIds, Func<PushSubscription, PushMessage> message, CancellationToken cancellationToken)
    {
        var ids = requestIds.ToList();
        PushSendResult result;
        try
        {
            result = await _sender.SendAsync(userId, message, ReadyTimeToLive, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            _progress.GiveBack(userId, endpoint, ids);
            throw;
        }

        if (!result.Delivered)
        {
            // Nobody was told: due again next pass, or, with no device left, for the pop-up.
            _progress.GiveBack(userId, endpoint, ids);
        }
    }
}
