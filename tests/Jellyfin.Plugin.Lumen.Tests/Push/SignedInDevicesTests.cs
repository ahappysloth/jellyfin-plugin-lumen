using Jellyfin.Data.Queries;
using Jellyfin.Database.Implementations.Entities.Security;
using Jellyfin.Plugin.Lumen.Push;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Model.Querying;
using Microsoft.Extensions.Logging;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Push;

public class SignedInDevicesTests
{
    private readonly IDeviceManager _manager = Substitute.For<IDeviceManager>();
    private readonly ListLogger<SignedInDevices> _log = new();
    private readonly SignedInDevices _devices;
    private readonly Guid _alice = Guid.NewGuid();
    private readonly Guid _bob = Guid.NewGuid();
    private readonly List<Device> _issued = [];
    private bool _apiChanged;
    private bool _busy;

    public SignedInDevicesTests()
    {
        _devices = new SignedInDevices(_manager, _log);

        // As Jellyfin's device list answers a query: by access token, or by user and device.
        _manager.GetDevices(default!).ReturnsForAnyArgs(call =>
        {
            if (_apiChanged)
            {
                // What a call into a Jellyfin whose method has another signature throws.
                throw new MissingMethodException("GetDevices");
            }

            if (_busy)
            {
                // What Jellyfin's database throws while it's busy, or closing: nothing to do with its API.
                throw new InvalidOperationException("A second operation was started on this context instance");
            }

            var query = call.Arg<DeviceQuery>();
            return new QueryResult<Device>(_issued
                .Where(d => query.AccessToken is null || d.AccessToken == query.AccessToken)
                .Where(d => query.UserId is null || d.UserId.Equals(query.UserId.Value))
                .Where(d => query.DeviceId is null || d.DeviceId == query.DeviceId)
                .ToList());
        });
    }

    [Fact]
    public void ForToken_IsTheDeviceTheTokenWasIssuedTo_WhateverTheRequestClaims()
    {
        var phone = Issue(_alice, "phone", "Safari iOS");
        Issue(_alice, "laptop", "Chrome");

        // The phone's token on a request whose header names the laptop: it's still the phone.
        var device = _devices.ForToken(_alice, phone, new SessionDevice("laptop", "Chrome"));

        Assert.Equal(new SessionDevice("phone", "Safari iOS"), device);
        _manager.Received(1).GetDevices(Arg.Is<DeviceQuery>(q => q.AccessToken == phone));
    }

    [Fact]
    public void ForToken_OfAnotherUser_OrNoDevicesAtAll_IsNoDevice()
    {
        var bobs = Issue(_bob, "phone", "Firefox");
        var claimed = new SessionDevice("phone", "Firefox");

        // Bob's token never stands for a device of Alice's; an API key is in no device row; no token, no device.
        Assert.Null(_devices.ForToken(_alice, bobs, claimed));
        Assert.Null(_devices.ForToken(_alice, "an-api-key", claimed));
        Assert.Null(_devices.ForToken(_alice, null, claimed));
        Assert.Null(_devices.ForToken(_alice, string.Empty, claimed));
        Assert.Equal(new SessionDevice("phone", "Firefox"), _devices.ForToken(_bob, bobs, null));
    }

    [Fact]
    public void ForToken_WithoutADeviceName_HasNone()
    {
        var token = Issue(_alice, "phone", " ");

        Assert.Equal(new SessionDevice("phone", null), _devices.ForToken(_alice, token, null));
    }

    [Fact]
    public void WhenJellyfinsDeviceListCantBeRead_TheClaimedDeviceStandsIn_AndItsLoggedOnce()
    {
        var phone = Issue(_alice, "phone", "Safari iOS");
        _apiChanged = true;
        var claimed = new SessionDevice("phone", "Safari iOS");

        // As before these checks: the feature goes on working on a Jellyfin whose API changed.
        Assert.Equal(claimed, _devices.ForToken(_alice, phone, claimed));
        Assert.Equal(claimed, _devices.ForToken(_alice, phone, claimed));
        Assert.True(_devices.IsSignedIn(_alice, "phone"));
        Assert.Null(_devices.ForToken(_alice, phone, null));
        Assert.Null(_devices.ForToken(_alice, null, claimed));

        Assert.Single(_log.Entries, e => e.Level == LogLevel.Warning);
        _manager.ReceivedWithAnyArgs(1).GetDevices(default!);
    }

    [Fact]
    public void AnErrorThatPasses_DoesntSwitchToTheClaimedDeviceForGood()
    {
        var phone = Issue(_alice, "phone", "Safari iOS");
        var claimed = new SessionDevice("laptop", "Chrome");
        _busy = true;

        // While it lasts: no device is taken on the request's word, and none loses its subscription over it.
        Assert.Throws<InvalidOperationException>(() => _devices.ForToken(_alice, phone, claimed));
        Assert.True(_devices.IsSignedIn(_alice, "phone"));
        Assert.True(_devices.IsSignedIn(_alice, "signed-out-long-ago"));
        Assert.Single(_log.Entries, e => e.Level == LogLevel.Warning);

        // Over: the device list is asked again, and answers as ever.
        _busy = false;
        Assert.Equal(new SessionDevice("phone", "Safari iOS"), _devices.ForToken(_alice, phone, claimed));
        Assert.True(_devices.IsSignedIn(_alice, "phone"));
        Assert.False(_devices.IsSignedIn(_alice, "signed-out-long-ago"));

        // And a later bout of it is logged again.
        _busy = true;
        Assert.True(_devices.IsSignedIn(_alice, "signed-out-long-ago"));
        Assert.Equal(2, _log.Entries.Count(e => e.Level == LogLevel.Warning));
    }

    [Fact]
    public void IsSignedIn_AsksForThatUsersDevice()
    {
        Issue(_alice, "phone", "Safari iOS");

        Assert.True(_devices.IsSignedIn(_alice, "phone"));
        Assert.False(_devices.IsSignedIn(_alice, "laptop"));
        Assert.False(_devices.IsSignedIn(_bob, "phone"));
    }

    private string Issue(Guid user, string deviceId, string deviceName)
    {
        var device = new Device(user, "Lumen", "1.0", deviceName, deviceId);
        _issued.Add(device);
        return device.AccessToken;
    }
}
