using System.Runtime.CompilerServices;
using Jellyfin.Data.Queries;
using MediaBrowser.Controller.Devices;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>Whether a device is still signed in as a user.</summary>
public interface ISignedInDevices
{
    /// <summary>
    /// False once the user signed out on the device (or an admin removed it, or the user's password was changed): Jellyfin
    /// has no access token for that user and device any more.
    /// </summary>
    bool IsSignedIn(Guid userId, string deviceId);
}

/// <summary>
/// Asks Jellyfin's device list, so that signing out of a browser also ends its notifications: without this, a
/// signed-out phone would go on showing what its last user requested. If a Jellyfin release changes that API, every
/// device counts as signed in (logged once), which is how it was before the check.
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
            if (Interlocked.Exchange(ref _unavailable, 1) == 0)
            {
                _logger.LogWarning("Lumen can't read Jellyfin's device list ({Message}), so a signed-out device keeps its notifications until they're turned off there.", e.Message);
            }

            return true;
        }
    }

    // On its own, and never inlined: a changed signature fails when this method is first compiled, inside the try above.
    [MethodImpl(MethodImplOptions.NoInlining)]
    private bool HasToken(Guid userId, string deviceId) =>
        _devices.GetDevices(new DeviceQuery { UserId = userId, DeviceId = deviceId, Limit = 1 }).Items.Count > 0;
}
