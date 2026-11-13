namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>
/// One Seerr answer that every caller shares: on its way (<see cref="Pending"/>), or fetched at <see cref="Fetched"/>
/// and fresh for <c>ttl</c> (a failure for <c>failureTtl</c>), so tabs, devices and pollers asking meanwhile cost Seerr
/// one call. A user's requests (<see cref="RequestProgressService"/>) and everyone's (<see cref="EveryonesRequests"/>).
/// </summary>
internal sealed class SharedAnswer<T>
{
    private readonly TaskCompletionSource<T> _source = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TimeSpan _ttl;
    private readonly TimeSpan _failureTtl;
    private long _fetched;

    public SharedAnswer(DateTimeOffset started, TimeSpan ttl, TimeSpan failureTtl)
    {
        _fetched = started.UtcTicks;
        _ttl = ttl;
        _failureTtl = failureTtl;
    }

    public Task<T> Task => _source.Task;

    public bool Pending => !_source.Task.IsCompleted;

    /// <summary>Gets when the answer arrived (its age counts from then, not from when it was asked for).</summary>
    public DateTimeOffset Fetched => new(Interlocked.Read(ref _fetched), TimeSpan.Zero);

    /// <summary>Whether to answer from this entry: on its way, or an answer (or a failure) that's young enough.</summary>
    public bool IsFresh(DateTimeOffset now) => Pending || Fetched + (_source.Task.IsFaulted ? _failureTtl : _ttl) > now;

    /// <summary>Settles this entry with <paramref name="fetch"/>'s outcome. Not tied to any caller's cancellation.</summary>
    public void Start(Task<T> fetch, TimeProvider time) =>
        fetch.ContinueWith(
            t =>
            {
                Interlocked.Exchange(ref _fetched, time.GetUtcNow().UtcTicks);
                if (t.IsCompletedSuccessfully)
                {
                    _source.TrySetResult(t.Result);
                }
                else
                {
                    _source.TrySetException(t.Exception?.InnerException ?? new SeerrException("Seerr didn't answer."));
                }
            },
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
}
