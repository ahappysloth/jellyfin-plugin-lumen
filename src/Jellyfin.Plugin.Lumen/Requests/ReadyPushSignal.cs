using System.Threading.Channels;
using Jellyfin.Plugin.Lumen.Push;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>
/// How the request list tells the push job that a user's request became ready, without depending on it (the job
/// depends on the request list).
/// </summary>
public interface IReadyPushSignal
{
    /// <summary>
    /// Whether "ready to watch" reaches this user as a push notification rather than as the in-app pop-up: they turned
    /// notifications on in some device, and the job that sends them is running.
    /// </summary>
    bool Covers(Guid userId);

    /// <summary>A request of the user's is ready and unannounced: have the push job send it now.</summary>
    void Wake(Guid userId);
}

/// <summary>What the push job is asked to do between its regular passes.</summary>
/// <param name="UserId">The user to check, or null for every user with notifications on.</param>
/// <param name="RequestId">A Seerr request to announce even if Lumen never saw it in flight (Seerr's webhook named it).</param>
public sealed record ReadyPushWork(Guid? UserId, int? RequestId = null);

/// <summary>Default <see cref="IReadyPushSignal"/>: a queue the push job (Push/ReadyPushJob) reads.</summary>
public sealed class ReadyPushSignal : IReadyPushSignal
{
    /// <summary>
    /// More waiting than this and new work isn't taken. A page's check asks again by itself; Seerr's webhook is told
    /// (<see cref="WakeAll"/>), as nothing else would announce a request it named.
    /// </summary>
    public const int MaxQueued = 256;

    // Wait, not DropWrite: a full queue must refuse the write, not swallow it and say it was taken.
    private readonly Channel<ReadyPushWork> _queue = Channel.CreateBounded<ReadyPushWork>(new BoundedChannelOptions(MaxQueued) { FullMode = BoundedChannelFullMode.Wait });
    private readonly IPushSubscriptionStore _subscriptions;
    private readonly ILogger<ReadyPushSignal> _logger;
    private volatile bool _running;
    private int _full;

    public ReadyPushSignal(IPushSubscriptionStore subscriptions, ILogger<ReadyPushSignal>? logger = null)
    {
        _subscriptions = subscriptions;
        _logger = logger ?? NullLogger<ReadyPushSignal>.Instance;
    }

    /// <summary>Gets the work asked for, for the job to read.</summary>
    public ChannelReader<ReadyPushWork> Work => _queue.Reader;

    /// <summary>
    /// Gets or sets a value indicating whether the job is running. While it isn't (Jellyfin never started it, or it has
    /// stopped), nobody would send the push, so the pop-up stays.
    /// </summary>
    public bool Running
    {
        get => _running;
        set => _running = value;
    }

    public bool Covers(Guid userId) => _running && _subscriptions.HasAny(userId);

    public void Wake(Guid userId) => _queue.Writer.TryWrite(new ReadyPushWork(userId));

    /// <summary>
    /// Seerr said something became available: check every user with notifications on now. False when too much is
    /// waiting already and this wasn't taken (logged once, until the queue takes work again): the caller says so, for
    /// Seerr to call again.
    /// </summary>
    public bool WakeAll(int? requestId)
    {
        if (_queue.Writer.TryWrite(new ReadyPushWork(null, requestId)))
        {
            Volatile.Write(ref _full, 0);
            return true;
        }

        if (Interlocked.Exchange(ref _full, 1) == 0)
        {
            _logger.LogWarning(
                "Lumen's notification queue is full ({Max} checks waiting), so Seerr's webhook is answered 503 until it has room. Not logged again until then.",
                MaxQueued);
        }

        return false;
    }
}
