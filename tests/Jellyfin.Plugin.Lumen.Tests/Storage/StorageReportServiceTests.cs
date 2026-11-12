using Jellyfin.Plugin.Lumen.Storage;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Storage;

public sealed class StorageReportServiceTests : IDisposable
{
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly FakeScanner _scanner;
    private readonly StorageReportService _service;

    public StorageReportServiceTests()
    {
        _scanner = new FakeScanner(_time);
        _service = new StorageReportService(_scanner, _time, new ListLogger<StorageReportService>());
    }

    public void Dispose()
    {
        _scanner.Release();
        _service.Dispose();
    }

    [Fact]
    public async Task AQuickScan_AnswersWithTheReport_ThenItIsKeptFor10Minutes()
    {
        _scanner.Release();

        var first = await _service.GetAsync(false, CancellationToken.None);
        _time.Advance(StorageReportService.CacheFor - TimeSpan.FromSeconds(1));
        var second = await _service.GetAsync(false, CancellationToken.None);

        Assert.Equal(StorageState.Ready, first.State);
        Assert.NotNull(first.Report);
        Assert.Same(first.Report, second.Report);
        Assert.Equal(1, _scanner.Scans);
    }

    [Fact]
    public async Task AStaleReport_IsScannedAgain()
    {
        _scanner.Release();
        await _service.GetAsync(false, CancellationToken.None);

        _time.Advance(StorageReportService.CacheFor);
        var status = await _service.GetAsync(false, CancellationToken.None);

        Assert.Equal(2, _scanner.Scans);
        Assert.Equal(_time.GetUtcNow(), status.Report!.ComputedAt);
    }

    [Fact]
    public async Task ASlowScan_AnswersComputing_AndOnlyOneRunsAtATime()
    {
        var first = _service.GetAsync(false, CancellationToken.None);
        _time.Advance(StorageReportService.AnswerWithin);
        var computing = await first;

        Assert.Equal(new StorageStatusDto(StorageState.Computing, null, null), computing);

        var again = _service.GetAsync(true, CancellationToken.None);
        _time.Advance(StorageReportService.AnswerWithin);
        Assert.Equal(StorageState.Computing, (await again).State);

        _scanner.Release();
        await WaitFor(() => _service.GetAsync(false, CancellationToken.None), s => s.State == StorageState.Ready);
        Assert.Equal(1, _scanner.Scans);
    }

    [Fact]
    public async Task WhileItRescans_ThePreviousReportIsShown()
    {
        _scanner.Release();
        var old = (await _service.GetAsync(false, CancellationToken.None)).Report;
        _scanner.Hold();

        var refreshing = _service.GetAsync(true, CancellationToken.None);
        _time.Advance(StorageReportService.AnswerWithin);
        var status = await refreshing;

        Assert.Equal(StorageState.Computing, status.State);
        Assert.Same(old, status.Report);
    }

    [Fact]
    public async Task Refresh_ScansAgainEvenWhenFresh()
    {
        _scanner.Release();
        await _service.GetAsync(false, CancellationToken.None);

        await _service.GetAsync(true, CancellationToken.None);

        Assert.Equal(2, _scanner.Scans);
    }

    [Fact]
    public async Task AFailedScan_IsReported_AndRetriedOnRefreshOrAfterAMinute()
    {
        _scanner.Fail = true;
        _scanner.Release();

        var failed = await _service.GetAsync(false, CancellationToken.None);
        Assert.Equal(StorageState.Failed, failed.State);
        Assert.NotNull(failed.Error);

        // Opening the page again straight away doesn't rescan.
        Assert.Equal(StorageState.Failed, (await _service.GetAsync(false, CancellationToken.None)).State);
        Assert.Equal(1, _scanner.Scans);

        _time.Advance(StorageReportService.RetryFailedAfter);
        await _service.GetAsync(false, CancellationToken.None);
        Assert.Equal(2, _scanner.Scans);

        _scanner.Fail = false;
        Assert.Equal(StorageState.Ready, (await _service.GetAsync(true, CancellationToken.None)).State);
        Assert.Equal(3, _scanner.Scans);
    }

    [Fact]
    public async Task ACancelledRequest_StopsWaiting_ButNotTheScan()
    {
        using var cts = new CancellationTokenSource();
        var request = _service.GetAsync(false, cts.Token);
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => request);
        Assert.False(_scanner.Token.IsCancellationRequested);

        _scanner.Release();
        await WaitFor(() => _service.GetAsync(false, CancellationToken.None), s => s.State == StorageState.Ready);
        Assert.Equal(1, _scanner.Scans);
    }

    [Fact]
    public async Task ShuttingDown_CancelsTheScan()
    {
        var request = _service.GetAsync(false, CancellationToken.None);
        await WaitFor(() => Task.FromResult(_scanner.Scans), n => n == 1);

        var token = _scanner.Token;
        _service.Dispose();

        Assert.True(token.IsCancellationRequested);
        await request;
    }

    private static async Task<T> WaitFor<T>(Func<Task<T>> read, Func<T, bool> done)
    {
        for (var i = 0; i < 200; i++)
        {
            var value = await read();
            if (done(value))
            {
                return value;
            }

            await Task.Delay(10);
        }

        throw new TimeoutException();
    }

    /// <summary>Scans block until released (a gate per scan, so a held scan can follow a released one).</summary>
    private sealed class FakeScanner(TimeProvider time) : IStorageScanner
    {
        private volatile TaskCompletionSource _gate = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public int Scans { get; private set; }

        public bool Fail { get; set; }

        public CancellationToken Token { get; private set; }

        public void Release() => _gate.TrySetResult();

        public void Hold() => _gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        public StorageReportDto Scan(CancellationToken cancellationToken)
        {
            Token = cancellationToken;
            Scans++;
            _gate.Task.Wait(cancellationToken);
            if (Fail)
            {
                throw new InvalidOperationException("database is locked");
            }

            return new StorageAggregator().Build(time.GetUtcNow(), 0);
        }
    }
}
