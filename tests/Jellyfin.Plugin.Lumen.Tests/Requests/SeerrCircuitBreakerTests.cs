using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public class SeerrCircuitBreakerTests
{
    private readonly FakeTimeProvider _time = new(TestData.Now);

    [Fact]
    public void ALateSuccess_FromBeforeTheBreakerOpened_DoesNotCloseIt()
    {
        var breaker = new SeerrCircuitBreaker(_time, NullLogger.Instance);
        var calls = Enumerable.Range(0, 4).Select(_ => breaker.TryEnter()!.Value).ToList();

        breaker.RecordFailure(calls[0]);
        breaker.RecordFailure(calls[1]);
        breaker.RecordFailure(calls[2]);
        Assert.True(breaker.IsOpen);

        breaker.RecordSuccess(calls[3]); // started while closed, finished after it opened
        Assert.True(breaker.IsOpen);
        Assert.Null(breaker.TryEnter());
    }

    [Fact]
    public void AfterTheCooldown_OnlyOneProbeGoesThrough_AndItsResultDecides()
    {
        var breaker = new SeerrCircuitBreaker(_time, NullLogger.Instance);
        for (var i = 0; i < SeerrCircuitBreaker.Threshold; i++)
        {
            breaker.RecordFailure(breaker.TryEnter()!.Value);
        }

        _time.Advance(SeerrCircuitBreaker.OpenFor);
        var probe = breaker.TryEnter();
        Assert.NotNull(probe);
        Assert.Null(breaker.TryEnter()); // a second caller waits for the probe

        breaker.RecordFailure(probe.Value);
        Assert.True(breaker.IsOpen); // one failed probe reopens it

        _time.Advance(SeerrCircuitBreaker.OpenFor);
        breaker.RecordSuccess(breaker.TryEnter()!.Value);
        Assert.NotNull(breaker.TryEnter());
        Assert.NotNull(breaker.TryEnter()); // closed: everyone through
    }

    [Fact]
    public void AnAbandonedProbe_FreesTheSlot()
    {
        var breaker = new SeerrCircuitBreaker(_time, NullLogger.Instance);
        for (var i = 0; i < SeerrCircuitBreaker.Threshold; i++)
        {
            breaker.RecordFailure(breaker.TryEnter()!.Value);
        }

        _time.Advance(SeerrCircuitBreaker.OpenFor);
        breaker.Abandon(breaker.TryEnter()!.Value);

        Assert.NotNull(breaker.TryEnter());
    }
}
