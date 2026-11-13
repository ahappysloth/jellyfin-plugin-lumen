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
    public void Claim_TakesAReadyRequestOnce_WhoeverAsksNext()
    {
        var store = Create();
        store.Update(_alice, Scope, [1, 2], [], []);

        // The push job takes it; the pop-up's check right after (or another pass) gets nothing.
        Assert.Equal([1], store.Claim(_alice, Scope, [2], [1], []));
        Assert.Empty(store.Update(_alice, Scope, [2], [1], []));
        Assert.Empty(store.Claim(_alice, Scope, [2], [1], []));
        Assert.Empty(Create().Update(_alice, Scope, [], [1], [])); // also after a restart
    }

    [Fact]
    public void Claim_GivenBack_IsDueAgain()
    {
        var store = Create();
        store.Update(_alice, Scope, [1], [], []);
        Assert.Equal([1], store.Claim(_alice, Scope, [], [1], []));

        // No device could be reached: the request goes back as if still in flight.
        store.Update(_alice, Scope, [1], [], []);

        Assert.Equal([1], store.Update(_alice, Scope, [], [1], []));
    }

    [Fact]
    public void Claim_NeverTakesWhatWasNeverSeenInFlight_OrAnotherUsers()
    {
        var store = Create();
        store.Update(_bob, Scope, [1], [], []);

        Assert.Empty(store.Claim(_alice, Scope, [], [1, 2], []));
        Assert.Equal([1], store.Update(_bob, Scope, [], [1], []));
    }

    [Fact]
    public void Claim_ARequestSeerrNamed_IsAnnouncedOnce_HoweverOftenItsNamed()
    {
        var store = Create();

        // Never seen in flight, but Seerr's webhook said it became available.
        Assert.Equal([7], store.Claim(_alice, Scope, [], [7], [], [7]));

        // Named again (and after a restart): the user was told.
        Assert.Empty(store.Claim(_alice, Scope, [], [7], [], [7]));
        Assert.Empty(Create().Claim(_alice, Scope, [], [7], [], [7]));
        Assert.Empty(store.Update(_alice, Scope, [], [7], []));
    }

    [Fact]
    public void Claim_ARequestSeerrNamed_AfterItsPopUpShowed_IsntAnnouncedAgain()
    {
        var store = Create();
        store.Update(_alice, Scope, [7], [], []);
        store.MarkAnnounced(_alice, Scope, [7]);

        Assert.Empty(store.Claim(_alice, Scope, [], [7], [], [7]));
    }

    [Fact]
    public void Claim_ANamedRequestGivenBack_IsDueAgain()
    {
        var store = Create();
        Assert.Equal([7], store.Claim(_alice, Scope, [], [7], [], [7]));

        store.Update(_alice, Scope, [7], [], []);

        Assert.Equal([7], store.Claim(_alice, Scope, [], [7], []));
    }

    [Fact]
    public void IsWatching_SaysWhoHasARequestInFlight()
    {
        var store = Create();
        Assert.False(store.IsWatching(_alice));

        store.Update(_alice, Scope, [1], [], []);
        Assert.True(store.IsWatching(_alice));
        Assert.False(store.IsWatching(_bob));

        store.Claim(_alice, Scope, [], [1], []);
        Assert.False(store.IsWatching(_alice));
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
