using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Diagnostics;

public class DiagnosticsStoreTests
{
    [Fact]
    public void ReturnsNewestFirst_AndDeduplicatesIdenticalReports()
    {
        var store = new DiagnosticsStore();
        store.Record(Report("web", "skinBody"), TestData.Now);
        store.Record(Report("ios", "apiClient"), TestData.Now.AddMinutes(1));
        store.Record(Report("web", "skinBody"), TestData.Now.AddMinutes(2));

        var all = store.GetAll();

        Assert.Equal(2, all.Count);
        Assert.Equal("web", all[0].Client);
        Assert.Equal(TestData.Now.AddMinutes(2), all[0].LastSeen);
    }

    [Fact]
    public void IsBounded_AndTruncatesInput()
    {
        var store = new DiagnosticsStore();
        for (var i = 0; i < 60; i++)
        {
            store.Record(Report($"client-{i}"), TestData.Now.AddSeconds(i));
        }

        store.Record(Report(new string('x', 500), [.. Enumerable.Range(0, 40).Select(i => $"check{i}"), new string('y', 500)]), TestData.Now.AddHours(1));

        var all = store.GetAll();
        Assert.Equal(DiagnosticsStore.Capacity, all.Count);

        // The client keeps a whole user agent (the Health tab reads the device and browser from it); the rest stays short.
        Assert.Equal(300, all[0].Client.Length);
        Assert.Equal(20, all[0].FailedChecks.Count);
        store.Record(Report("web", new string('y', 500)), TestData.Now.AddHours(2));
        Assert.Equal(100, store.GetAll()[0].FailedChecks[0].Length);
    }

    private static CompatReportDto Report(string client, params string[] failed) =>
        new() { Client = client, ServerVersion = "12.1.0", FailedChecks = failed.ToList() };
}
