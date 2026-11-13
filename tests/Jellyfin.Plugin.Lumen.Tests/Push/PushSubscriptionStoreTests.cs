using Jellyfin.Plugin.Lumen.Push;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Push;

public sealed class PushSubscriptionStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "lumen-push-" + Guid.NewGuid().ToString("N"));
    private readonly Guid _alice = Guid.NewGuid();
    private readonly Guid _bob = Guid.NewGuid();

    private string FilePath => Path.Combine(_dir, "push-subscriptions.json");

    public void Dispose()
    {
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, true);
        }
    }

    [Fact]
    public void ADevicesSubscription_IsStoredPerUserAndDevice()
    {
        var store = Create();
        Assert.False(store.HasAny(_alice));

        store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        store.Save(_alice, Subscription("laptop", "https://fcm.googleapis.com/fcm/send/b"));

        Assert.True(store.HasAny(_alice));
        Assert.False(store.HasAny(_bob));
        Assert.Equal(["phone", "laptop"], store.ForUser(_alice).Select(s => s.DeviceId));
        Assert.Equal("https://web.push.apple.com/a", store.ForDevice(_alice, "phone")!.Endpoint);
        Assert.Null(store.ForDevice(_bob, "phone"));
        Assert.Null(store.ForDevice(_alice, "tv"));
        Assert.Equal([_alice], store.Users());
        Assert.Equal((2, 1), store.Count());
    }

    [Fact]
    public void SubscribingAgain_ReplacesTheDevicesLastSubscription()
    {
        var store = Create();
        store.Save(_alice, Subscription("phone", "https://web.push.apple.com/old"));

        store.Save(_alice, Subscription("phone", "https://web.push.apple.com/new"));

        Assert.Equal("https://web.push.apple.com/new", Assert.Single(store.ForUser(_alice)).Endpoint);
    }

    [Fact]
    public void APushAddress_BelongsToOneUser_TheLastWhoSubscribedFromThatBrowser()
    {
        var store = Create();
        store.Save(_alice, Subscription("browser-as-alice", "https://fcm.googleapis.com/fcm/send/shared"));

        store.Save(_bob, Subscription("browser-as-bob", "https://fcm.googleapis.com/fcm/send/shared"));

        // Alice's notifications no longer go to the browser Bob now uses.
        Assert.False(store.HasAny(_alice));
        Assert.Equal([_bob], store.Users());
        Assert.Single(store.ForUser(_bob));
    }

    [Fact]
    public void Remove_OnlyTakesThatUsersDevice()
    {
        var store = Create();
        store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        store.Save(_bob, Subscription("phone", "https://web.push.apple.com/b"));

        Assert.True(store.Remove(_alice, "phone"));
        Assert.False(store.Remove(_alice, "phone"));

        Assert.False(store.HasAny(_alice));
        Assert.Single(store.ForUser(_bob));
    }

    [Fact]
    public void RemoveEndpoint_DropsASubscriptionThePushServiceSaysIsGone()
    {
        var store = Create();
        store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        store.Save(_alice, Subscription("laptop", "https://fcm.googleapis.com/fcm/send/b"));

        Assert.True(store.RemoveEndpoint(_alice, "https://web.push.apple.com/a"));
        Assert.False(store.RemoveEndpoint(_alice, "https://web.push.apple.com/a"));
        Assert.False(store.RemoveEndpoint(_bob, "https://fcm.googleapis.com/fcm/send/b"));

        Assert.Equal(["laptop"], store.ForUser(_alice).Select(s => s.DeviceId));
    }

    [Fact]
    public void AUserKeepsTheNewestDevices_UpToTheLimit()
    {
        var store = Create();
        for (var i = 0; i < PushSubscriptionStore.MaxPerUser + 3; i++)
        {
            store.Save(_alice, Subscription("device-" + i, "https://web.push.apple.com/" + i));
        }

        var kept = store.ForUser(_alice);
        Assert.Equal(PushSubscriptionStore.MaxPerUser, kept.Count);
        Assert.Equal("device-3", kept[0].DeviceId);
        Assert.Equal("device-12", kept[^1].DeviceId);
    }

    [Fact]
    public void Clear_RemovesEveryonesSubscriptions()
    {
        var store = Create();
        store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        store.Save(_bob, Subscription("phone", "https://web.push.apple.com/b"));

        Assert.Equal(2, store.Clear());

        Assert.Equal((0, 0), store.Count());
        Assert.Equal((0, 0), Create().Count());
    }

    [Fact]
    public void Removed_NamesEveryAddressThatsNoLongerStored_WhateverTheReason()
    {
        var store = Create();
        var removed = new List<string>();
        store.Removed += removed.Add;
        store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        store.Save(_alice, Subscription("laptop", "https://fcm.googleapis.com/fcm/send/b"));
        store.Save(_bob, Subscription("bobs", "https://web.push.apple.com/c"));

        // Stored again as it is: nothing went.
        store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        Assert.Empty(removed);

        store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a2")); // the device subscribed afresh
        store.Remove(_alice, "laptop"); // turned off
        store.RemoveEndpoint(_bob, "https://web.push.apple.com/c"); // gone
        store.Remove(_bob, "bobs"); // nothing left to remove
        Assert.Equal(["https://web.push.apple.com/a", "https://fcm.googleapis.com/fcm/send/b", "https://web.push.apple.com/c"], removed);

        // The keys were reset: everything that's left.
        removed.Clear();
        store.Clear();
        Assert.Equal(["https://web.push.apple.com/a2"], removed);
    }

    [Fact]
    public void Removed_AlsoNamesTheDevicesPushedOutByNewerOnes()
    {
        var store = Create();
        var removed = new List<string>();
        store.Removed += removed.Add;

        for (var i = 0; i <= PushSubscriptionStore.MaxPerUser; i++)
        {
            store.Save(_alice, Subscription("device-" + i, "https://web.push.apple.com/" + i));
        }

        Assert.Equal(["https://web.push.apple.com/0"], removed);
    }

    [Fact]
    public void AFileWrittenWithEachDevicesLanguage_StillReads()
    {
        // Subscriptions carried a "Locale" before it was dropped.
        Directory.CreateDirectory(_dir);
        File.WriteAllText(FilePath, "{\"" + _alice.ToString("N") + "\":[{\"Endpoint\":\"https://web.push.apple.com/a\",\"P256dh\":\"p\",\"Auth\":\"a\",\"DeviceId\":\"phone\",\"DeviceName\":\"Safari\",\"Locale\":\"de-DE\",\"Created\":\"2026-11-01T00:00:00+00:00\"}]}");

        Assert.Equal("phone", Assert.Single(Create().ForUser(_alice)).DeviceId);
    }

    [Fact]
    public void Subscriptions_OutlastARestart_ButNotTheirUser()
    {
        Create().Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        Create().Save(_bob, Subscription("phone", "https://web.push.apple.com/b"));

        Assert.Equal("https://web.push.apple.com/a", Create().ForDevice(_alice, "phone")!.Endpoint);

        // Bob's account was deleted.
        var later = Create(id => id == _alice);
        Assert.Equal([_alice], later.Users());
        Assert.Empty(later.ForUser(_bob));
    }

    [Fact]
    public void AnUnreadableFile_StartsOver()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(FilePath, "{ not json");

        var store = Create();

        Assert.Equal((0, 0), store.Count());
        store.Save(_alice, Subscription("phone", "https://web.push.apple.com/a"));
        Assert.True(Create().HasAny(_alice));
    }

    [Fact]
    public void ToString_ShowsTheDeviceAndTheHost_NeverTheAddressOrKeys()
    {
        var text = Subscription("phone", "https://web.push.apple.com/QGsecret-capability").ToString();

        Assert.Contains("web.push.apple.com", text, StringComparison.Ordinal);
        Assert.DoesNotContain("QGsecret", text, StringComparison.Ordinal);
        Assert.DoesNotContain("p256", text, StringComparison.Ordinal);
    }

    internal static PushSubscription Subscription(string deviceId, string endpoint) =>
        new(endpoint, "p256-" + deviceId, "auth-" + deviceId, deviceId, "Device " + deviceId, TestData.Now);

    private PushSubscriptionStore Create(Func<Guid, bool>? userExists = null) => new(FilePath, NullLogger<PushSubscriptionStore>.Instance, userExists);
}
