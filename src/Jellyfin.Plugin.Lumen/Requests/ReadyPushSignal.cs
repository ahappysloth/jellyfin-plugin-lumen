using System.Threading.Channels;
using Jellyfin.Plugin.Lumen.Push;

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
    /// <summary>More waiting than this and new work is dropped: the job's next regular pass covers it.</summary>
    public const int MaxQueued = 256;

    private readonly Channel<ReadyPushWork> _queue = Channel.CreateBounded<ReadyPushWork>(new BoundedChannelOptions(MaxQueued) { FullMode = BoundedChannelFullMode.DropWrite });
    private readonly IPushSubscriptionStore _subscriptions;
    private volatile bool _running;

    public ReadyPushSignal(IPushSubscriptionStore subscriptions)
    {
        _subscriptions = subscriptions;
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

    /// <summary>Seerr said something became available: check every user with notifications on now.</summary>
    public bool WakeAll(int? requestId) => _queue.Writer.TryWrite(new ReadyPushWork(null, requestId));
}
