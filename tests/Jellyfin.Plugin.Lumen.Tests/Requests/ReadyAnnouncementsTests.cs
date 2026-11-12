using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public sealed class ReadyAnnouncementsTests : IDisposable
{
    private const string Scope = "http://seerr:5055/";
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "lumen-announce-" + Guid.NewGuid().ToString("N"));
    private readonly Guid _alice = Guid.NewGuid();
    private readonly Guid _bob = Guid.NewGuid();

    private string FilePath => Path.Combine(_dir, "ready-announcements.json");

    public void Dispose()
    {
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, true);
        }
    }

    [Fact]
    public void ARequestSeenInFlight_IsAnnouncedWhenReady_UntilMarked()
    {
        var store = Create();
        Assert.Empty(store.Update(_alice, Scope, [1], [], []));

        Assert.Equal([1], store.Update(_alice, Scope, [], [1], []));
        Assert.Equal([1], store.Update(_alice, Scope, [], [1], [])); // until a device says it showed it
        store.MarkAnnounced(_alice, Scope, [1]);

        Assert.Empty(store.Update(_alice, Scope, [], [1], []));
    }

    [Fact]
    public void ARequestNeverSeenInFlight_IsNeverAnnounced()
    {
        // Ready before Lumen first looked (or before this feature): no pop-up for old requests.
        Assert.Empty(Create().Update(_alice, Scope, [], [1, 2], []));
    }

    [Fact]
    public void DeclinedOrFailed_IsForgotten()
    {
        var store = Create();
        store.Update(_alice, Scope, [1], [], []);
        store.Update(_alice, Scope, [], [], [1]);

        Assert.Empty(store.Update(_alice, Scope, [], [1], []));
    }

    [Fact]
    public void EachUserHasTheirOwnList()
    {
        var store = Create();
        store.Update(_alice, Scope, [1], [], []);

        Assert.Empty(store.Update(_bob, Scope, [], [1], []));
        store.MarkAnnounced(_bob, Scope, [1]);
        Assert.Equal([1], store.Update(_alice, Scope, [], [1], []));
    }

    [Fact]
    public void AnotherSeerr_StartsTheListOver()
    {
        var store = Create();
        store.Update(_alice, Scope, [1], [], []);

        Assert.Empty(store.Update(_alice, "http://other:5055/", [], [1], []));
    }

    [Fact]
    public void TheListSurvivesARestart()
    {
        Create().Update(_alice, Scope, [1, 2], [], []);
        Create().MarkAnnounced(_alice, Scope, [2]);

        Assert.True(File.Exists(FilePath));
        Assert.Equal([1], Create().Update(_alice, Scope, [], [1, 2], []));
    }

    [Fact]
    public void AnUnreadableFile_StartsOver()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(FilePath, "not json");

        var store = Create();
        store.Update(_alice, Scope, [1], [], []);
        Assert.Equal([1], store.Update(_alice, Scope, [], [1], []));
    }

    [Fact]
    public void EachUserKeepsTheNewestIds()
    {
        var store = Create();
        store.Update(_alice, Scope, Enumerable.Range(1, ReadyAnnouncements.MaxPerUser + 10), [], []);

        Assert.Empty(store.Update(_alice, Scope, [], [1], []));
        Assert.Equal([ReadyAnnouncements.MaxPerUser + 10], store.Update(_alice, Scope, [], [ReadyAnnouncements.MaxPerUser + 10], []));
    }

    [Fact]
    public void UsersJellyfinNoLongerHas_AreDroppedWhenTheFileIsRead()
    {
        var store = Create();
        store.Update(_alice, Scope, [1], [], []);
        store.Update(_bob, Scope, [2], [], []);

        // Bob's account was deleted meanwhile.
        var reloaded = new ReadyAnnouncements(FilePath, NullLogger<ReadyAnnouncements>.Instance, id => id != _bob);
        Assert.Equal([1], reloaded.Update(_alice, Scope, [], [1], []));
        Assert.Empty(reloaded.Update(_bob, Scope, [], [2], []));
    }

    private ReadyAnnouncements Create() => new(FilePath, NullLogger<ReadyAnnouncements>.Instance);
}
