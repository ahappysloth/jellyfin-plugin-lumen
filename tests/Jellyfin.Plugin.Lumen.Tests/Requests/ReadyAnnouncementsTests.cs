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

        // No device could be reached: the request is due again, to whoever asks next.
        store.GiveBack(_alice, Scope, [1]);

        Assert.Equal([1], store.Update(_alice, Scope, [], [1], []));
        Assert.Equal([1], store.Claim(_alice, Scope, [], [1], []));
    }

    [Fact]
    public void Claim_Released_IsThePopUpsAlone_UntilItShows()
    {
        var store = Create();
        store.Update(_alice, Scope, [1, 2], [], []);
        Assert.Equal([1], store.Claim(_alice, Scope, [2], [1], []));

        // The push job gave up on it (no device could be reached for minutes).
        store.Release(_alice, Scope, [1]);

        Assert.Equal([1], store.PopUpOnly(_alice, Scope));
        Assert.Empty(store.Claim(_alice, Scope, [2], [1], [])); // never pushed late
        Assert.Equal([1], store.Update(_alice, Scope, [2], [1], [])); // offered to the pop-up
        Assert.Equal([1], Create().PopUpOnly(_alice, Scope)); // also after a restart

        // Another request of the user's is pushed as ever.
        Assert.Equal([2], store.Claim(_alice, Scope, [], [1, 2], []));

        store.MarkAnnounced(_alice, Scope, [1]);
        Assert.Empty(store.PopUpOnly(_alice, Scope));
        Assert.Empty(store.Update(_alice, Scope, [], [1, 2], []));
    }

    [Fact]
    public void AReleasedRequest_BackInFlight_IsPushedAgainWhenReady()
    {
        var store = Create();
        store.Update(_alice, Scope, [1], [], []);
        store.Claim(_alice, Scope, [], [1], []);
        store.Release(_alice, Scope, [1]);

        store.Update(_alice, Scope, [1], [], []);

        Assert.Empty(store.PopUpOnly(_alice, Scope));
        Assert.Equal([1], store.Claim(_alice, Scope, [], [1], []));
    }

    [Fact]
    public void GivenBackOrReleased_UnderAnotherSeerr_ChangesNothing()
    {
        var store = Create();
        store.Update(_alice, Scope, [1], [], []);
        store.Claim(_alice, Scope, [], [1], []);

        // Lumen was pointed at another Seerr while a push was being retried: the user's new list isn't started over.
        store.Update(_alice, "http://other:5055/", [8], [], []);
        store.GiveBack(_alice, Scope, [1]);
        store.Release(_alice, Scope, [1]);
        store.GiveBack(_bob, Scope, [1]);

        Assert.Equal([8], store.Update(_alice, "http://other:5055/", [], [8], []));
        Assert.Empty(store.PopUpOnly(_alice, "http://other:5055/"));
        Assert.Empty(store.Update(_bob, Scope, [], [1], []));
    }

    [Fact]
    public void Watch_AddsARequestFiledThroughLumen_AndKeepsTheOthers()
    {
        var store = Create();
        store.Watch(_alice, Scope, [1]);
        store.Watch(_alice, Scope, [2]);

        Assert.Equal([1, 2], store.Update(_alice, Scope, [], [1, 2], []).Order());
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

        store.GiveBack(_alice, Scope, [7]);

        Assert.Equal([7], store.Claim(_alice, Scope, [], [7], []));
    }

    [Fact]
    public void ExpectsSoon_SaysWhoHasARequestInFlight()
    {
        var store = Create();
        Assert.False(store.ExpectsSoon(_alice));

        store.Update(_alice, Scope, [1], [], []);
        Assert.True(store.ExpectsSoon(_alice));
        Assert.False(store.ExpectsSoon(_bob));

        store.Claim(_alice, Scope, [], [1], []);
        Assert.False(store.ExpectsSoon(_alice));
    }

    [Fact]
    public void ExpectsSoon_NotForRequestsThatAreOnlyWaiting()
    {
        var store = Create();

        // 1 has waited for an approval for days; it's watched, but nothing is expected of it any minute.
        store.Update(_alice, Scope, [1], [], [1]);
        Assert.False(store.ExpectsSoon(_alice));
        Assert.False(Create().ExpectsSoon(_alice)); // also after a restart

        // Another one downloading: the user is worth asking about every pass.
        store.Update(_alice, Scope, [1, 2], [], [1]);
        Assert.True(store.ExpectsSoon(_alice));

        // It was approved and started downloading.
        store.Update(_alice, Scope, [1], [], []);
        Assert.True(store.ExpectsSoon(_alice));

        // Waiting or not, it's announced when it's ready.
        store.Update(_alice, Scope, [1], [], [1]);
        Assert.Equal([1], store.Claim(_alice, Scope, [], [1], []));
    }

    [Fact]
    public void ARequestSeerrNoLongerLists_IsntWatchedAnyMore()
    {
        var store = Create();
        store.Update(_alice, Scope, [1, 2, 3], [], [3]);

        // 1 was deleted in Seerr (or pushed out of the list by newer requests); 3 too, while it was waiting.
        store.Update(_alice, Scope, [2], [], []);
        Assert.True(store.ExpectsSoon(_alice));
        store.Update(_alice, Scope, [], [], []);

        // Nothing left to ask Seerr about every pass, and nothing announced if the ids ever show up again as ready.
        Assert.False(store.ExpectsSoon(_alice));
        Assert.False(Create().ExpectsSoon(_alice));
        Assert.Empty(store.Update(_alice, Scope, [], [1, 2, 3], []));
    }

    [Fact]
    public void AReleasedRequestSeerrNoLongerLists_IsForgottenToo()
    {
        var store = Create();
        store.Update(_alice, Scope, [1], [], []);
        store.Claim(_alice, Scope, [], [1], []);
        store.Release(_alice, Scope, [1]);

        store.Update(_alice, Scope, [], [], []);

        Assert.Empty(store.PopUpOnly(_alice, Scope));
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

        // Seerr still lists it, but neither in flight nor ready.
        store.Update(_alice, Scope, [], [], []);

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

        Assert.Equal([ReadyAnnouncements.MaxPerUser + 10], store.Update(_alice, Scope, [], [1, ReadyAnnouncements.MaxPerUser + 10], []));
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
