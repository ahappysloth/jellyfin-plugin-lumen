using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>
/// A circuit breaker for user-facing Seerr calls (requests design spec, §7): after <see cref="Threshold"/> consecutive
/// failures every call fails fast for <see cref="OpenFor"/>. Then one probe call is let through (half-open): success
/// closes the breaker, failure opens it again. Each call carries the generation it started in, so a late result from
/// before the breaker opened can't close it or count twice. Opening and closing are logged once.
/// </summary>
public sealed class SeerrCircuitBreaker
{
    public const int Threshold = 3;
    public static readonly TimeSpan OpenFor = TimeSpan.FromMinutes(1);

    private readonly Lock _lock = new();
    private readonly TimeProvider _time;
    private readonly ILogger _logger;
    private int _failures;
    private long _generation;
    private DateTimeOffset _openUntil = DateTimeOffset.MinValue;
    private bool _tripped;
    private bool _probing;

    public SeerrCircuitBreaker(TimeProvider time, ILogger logger)
    {
        _time = time;
        _logger = logger;
    }

    /// <summary>Gets a value indicating whether the breaker is in its fail-fast window.</summary>
    public bool IsOpen
    {
        get
        {
            lock (_lock)
            {
                return _openUntil > _time.GetUtcNow();
            }
        }
    }

    /// <summary>
    /// Asks to make a call. Returns the generation to report the result with, or null to fail fast (open, or another
    /// call is already probing). Every non-null result must end in exactly one Record or Abandon call.
    /// </summary>
    public long? TryEnter()
    {
        lock (_lock)
        {
            if (_openUntil > _time.GetUtcNow())
            {
                return null;
            }

            if (_tripped)
            {
                if (_probing)
                {
                    return null;
                }

                _probing = true;
            }

            return _generation;
        }
    }

    public void RecordSuccess(long generation)
    {
        lock (_lock)
        {
            if (generation != _generation)
            {
                return; // started before the breaker opened: says nothing about Seerr now
            }

            if (_tripped)
            {
                _logger.LogInformation("Lumen's Seerr connection recovered; request features are back.");
            }

            _failures = 0;
            _openUntil = DateTimeOffset.MinValue;
            _tripped = false;
            _probing = false;
        }
    }

    public void RecordFailure(long generation)
    {
        lock (_lock)
        {
            if (generation != _generation)
            {
                return;
            }

            _failures++;
            if (!_probing && _failures < Threshold)
            {
                return;
            }

            _generation++;
            _openUntil = _time.GetUtcNow() + OpenFor;
            _probing = false;
            if (!_tripped)
            {
                _tripped = true;
                _logger.LogWarning(
                    "Lumen's Seerr calls failed {Count} times in a row; request features are paused for {Duration}.",
                    _failures,
                    OpenFor);
            }
        }
    }

    /// <summary>A call that ended without a verdict (the caller gave up): frees the probe slot.</summary>
    public void Abandon(long generation)
    {
        lock (_lock)
        {
            if (generation == _generation)
            {
                _probing = false;
            }
        }
    }
}
