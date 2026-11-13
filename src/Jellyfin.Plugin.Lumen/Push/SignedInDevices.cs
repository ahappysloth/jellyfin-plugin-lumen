using System.Runtime.CompilerServices;
using Jellyfin.Data.Queries;
using MediaBrowser.Controller.Devices;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>Which devices are signed in as a user.</summary>
public interface ISignedInDevices
{
    /// <summary>
    /// The device <paramref name="accessToken"/> was issued to, if it's <paramref name="userId"/>'s: null for an API
    /// key, or a token Jellyfin doesn't have. Jellyfin's own device id claim isn't that: it repeats whatever the
    /// request's <c>Authorization</c> header says, so with it one of a user's sessions could act as another of their
    /// devices. <paramref name="claimed"/> (that claim's device) is only what's answered when Jellyfin's device list
    /// can't be read at all.
    /// </summary>
    SessionDevice? ForToken(Guid userId, string? accessToken, SessionDevice? claimed);

    /// <summary>
    /// False once the user signed out on the device (or an admin removed it, or the user's password was changed): Jellyfin
    /// has no access token for that user and device any more.
    /// </summary>
    bool IsSignedIn(Guid userId, string deviceId);
}

/// <summary>The device a request is signed in from: its id for Jellyfin, and its name ("Safari iOS").</summary>
public sealed record SessionDevice(string Id, string? Name);

/// <summary>
/// Asks Jellyfin's device list, so that signing out of a browser also ends its notifications: without this, a
/// signed-out phone would go on showing what its last user requested. If a Jellyfin release changes that API, every
/// device counts as signed in, and a session's device is the one its request names (logged once), which is how it was
/// before these checks.
/// </summary>
public sealed class SignedInDevices : ISignedInDevices
{
    private readonly IDeviceManager _devices;
    private readonly ILogger<SignedInDevices> _logger;
    private int _unavailable;

    public SignedInDevices(IDeviceManager devices, ILogger<SignedInDevices> logger)
    {
        _devices = devices;
        _logger = logger;
    }

    public bool IsSignedIn(Guid userId, string deviceId)
    {
        if (Volatile.Read(ref _unavailable) != 0)
        {
            return true;
        }

        try
        {
            return HasToken(userId, deviceId);
        }
        catch (Exception e) when (e is MissingMethodException or MissingMemberException or TypeLoadException or NotSupportedException or InvalidOperationException)
        {
            Unavailable(e);
            return true;
        }
    }

    public SessionDevice? ForToken(Guid userId, string? accessToken, SessionDevice? claimed)
    {
        if (string.IsNullOrEmpty(accessToken))
        {
            return null;
        }

        if (Volatile.Read(ref _unavailable) != 0)
        {
            return claimed;
        }

        try
        {
            return TokenDevice(userId, accessToken);
        }
        catch (Exception e) when (e is MissingMethodException or MissingMemberException or TypeLoadException or NotSupportedException or InvalidOperationException)
        {
            Unavailable(e);
            return claimed;
        }
    }

    private void Unavailable(Exception e)
    {
        if (Interlocked.Exchange(ref _unavailable, 1) == 0)
        {
            _logger.LogWarning(
                "Lumen can't read Jellyfin's device list ({Message}), so a signed-out device keeps its notifications until they're turned off there, and a session's device is the one its requests name.",
                e.Message);
        }
    }

    // On its own, and never inlined: a changed signature fails when this method is first compiled, inside the try above.
    [MethodImpl(MethodImplOptions.NoInlining)]
    private bool HasToken(Guid userId, string deviceId) =>
        _devices.GetDevices(new DeviceQuery { UserId = userId, DeviceId = deviceId, Limit = 1 }).Items.Count > 0;

    // As HasToken: on its own for the same reason.
    [MethodImpl(MethodImplOptions.NoInlining)]
    private SessionDevice? TokenDevice(Guid userId, string accessToken)
    {
        foreach (var device in _devices.GetDevices(new DeviceQuery { AccessToken = accessToken, Limit = 1 }).Items)
        {
            // The token's own row: Jellyfin keeps the device id given at sign-in there, whatever later requests claim.
            if (device.UserId.Equals(userId) && string.Equals(device.AccessToken, accessToken, StringComparison.Ordinal) && !string.IsNullOrWhiteSpace(device.DeviceId))
            {
                return new SessionDevice(device.DeviceId, string.IsNullOrWhiteSpace(device.DeviceName) ? null : device.DeviceName);
            }
        }

        return null;
    }
}
