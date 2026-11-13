using System.Globalization;
using System.Text.Json;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>The devices each user turned notifications on in.</summary>
public interface IPushSubscriptionStore
{
    /// <summary>
    /// A subscription is no longer stored, whatever the reason (turned off, replaced, gone, its keys reset): its push
    /// address is given, so whoever remembers something about it can forget that.
    /// </summary>
    event Action<string>? Removed;

    /// <summary>Whether the user has notifications on in at least one device.</summary>
    bool HasAny(Guid userId);

    /// <summary>The users with notifications on somewhere.</summary>
    IReadOnlyList<Guid> Users();

    IReadOnlyList<PushSubscription> ForUser(Guid userId);

    /// <summary>This device's subscription, or null.</summary>
    PushSubscription? ForDevice(Guid userId, string deviceId);

    /// <summary>
    /// Stores the device's subscription in place of its last one. A push address belongs to one user: if another user
    /// subscribed from the same browser before, theirs is removed, so their notifications stop going to it.
    /// </summary>
    void Save(Guid userId, PushSubscription subscription);

    /// <summary>Removes this device's subscription. False if it had none.</summary>
    bool Remove(Guid userId, string deviceId);

    /// <summary>Removes the subscription with this address, which the push service says is gone. False if it wasn't there.</summary>
    bool RemoveEndpoint(Guid userId, string endpoint);

    /// <summary>Removes every subscription (Web Push's keys were replaced). Returns how many there were.</summary>
    int Clear();

    (int Devices, int Users) Count();
}

/// <summary>
/// Keeps the subscriptions in a small JSON file in Jellyfin's data folder (next to the ready-announcements file), so
/// they outlast restarts. Each user keeps at most <see cref="MaxPerUser"/> devices (the newest), and users Jellyfin no
/// longer has are left out when the file is read. The file holds push addresses and the browsers' keys: enough to send
/// a device a message only together with Web Push's private key, which stays in the plugin's configuration.
/// </summary>
public sealed class PushSubscriptionStore : IPushSubscriptionStore
{
    public const int MaxPerUser = 10;

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };
    private readonly Lock _lock = new();
    private readonly string _path;
    private readonly ILogger<PushSubscriptionStore> _logger;
    private readonly Func<Guid, bool> _userExists;
    private Dictionary<string, List<PushSubscription>>? _users;

    public PushSubscriptionStore(IApplicationPaths paths, IUserManager users, ILogger<PushSubscriptionStore> logger)
        : this(Path.Combine(paths.DataPath, "lumen", "push-subscriptions.json"), logger, id => users.GetUserById(id) is not null)
    {
    }

    internal PushSubscriptionStore(string path, ILogger<PushSubscriptionStore> logger, Func<Guid, bool>? userExists = null)
    {
        _path = path;
        _logger = logger;
        _userExists = userExists ?? (_ => true);
    }

    public event Action<string>? Removed;

    public bool HasAny(Guid userId)
    {
        lock (_lock)
        {
            return All().TryGetValue(Key(userId), out var list) && list.Count > 0;
        }
    }

    public IReadOnlyList<Guid> Users()
    {
        lock (_lock)
        {
            return All().Where(u => u.Value.Count > 0).Select(u => Guid.ParseExact(u.Key, "N")).ToList();
        }
    }

    public IReadOnlyList<PushSubscription> ForUser(Guid userId)
    {
        lock (_lock)
        {
            return All().TryGetValue(Key(userId), out var list) ? list.ToList() : [];
        }
    }

    public PushSubscription? ForDevice(Guid userId, string deviceId)
    {
        lock (_lock)
        {
            return All().TryGetValue(Key(userId), out var list) ? list.Find(s => s.DeviceId == deviceId) : null;
        }
    }

    public void Save(Guid userId, PushSubscription subscription)
    {
        var removed = new List<string>();
        lock (_lock)
        {
            var all = All();
            foreach (var other in all.Values)
            {
                other.RemoveAll(s => s.Endpoint == subscription.Endpoint);
            }

            var key = Key(userId);
            if (!all.TryGetValue(key, out var list))
            {
                all[key] = list = [];
            }

            removed.AddRange(list.Where(s => s.DeviceId == subscription.DeviceId).Select(s => s.Endpoint));
            list.RemoveAll(s => s.DeviceId == subscription.DeviceId);
            list.Add(subscription);
            if (list.Count > MaxPerUser)
            {
                removed.AddRange(list.Take(list.Count - MaxPerUser).Select(s => s.Endpoint));
                list.RemoveRange(0, list.Count - MaxPerUser);
            }

            Prune(all);
            Write();
        }

        Forget(removed);
    }

    public bool Remove(Guid userId, string deviceId) => RemoveWhere(userId, s => s.DeviceId == deviceId);

    public bool RemoveEndpoint(Guid userId, string endpoint) => RemoveWhere(userId, s => s.Endpoint == endpoint);

    public int Clear()
    {
        List<string> removed;
        lock (_lock)
        {
            removed = All().Values.SelectMany(l => l).Select(s => s.Endpoint).ToList();
            _users = new Dictionary<string, List<PushSubscription>>(StringComparer.Ordinal);
            Write();
        }

        Forget(removed);
        return removed.Count;
    }

    public (int Devices, int Users) Count()
    {
        lock (_lock)
        {
            var all = All();
            return (all.Values.Sum(l => l.Count), all.Values.Count(l => l.Count > 0));
        }
    }

    private static string Key(Guid userId) => userId.ToString("N", CultureInfo.InvariantCulture);

    private static void Prune(Dictionary<string, List<PushSubscription>> all)
    {
        foreach (var empty in all.Where(u => u.Value.Count == 0).Select(u => u.Key).ToList())
        {
            all.Remove(empty);
        }
    }

    private bool RemoveWhere(Guid userId, Predicate<PushSubscription> match)
    {
        List<string> removed;
        lock (_lock)
        {
            var all = All();
            if (!all.TryGetValue(Key(userId), out var list))
            {
                return false;
            }

            removed = list.FindAll(match).Select(s => s.Endpoint).ToList();
            if (list.RemoveAll(match) == 0)
            {
                return false;
            }

            Prune(all);
            Write();
        }

        Forget(removed);
        return true;
    }

    /// <summary>Outside the lock: a listener may call back into the store.</summary>
    private void Forget(List<string> endpoints)
    {
        foreach (var endpoint in endpoints)
        {
            Removed?.Invoke(endpoint);
        }
    }

    private Dictionary<string, List<PushSubscription>> All() => _users ??= Load();

    private Dictionary<string, List<PushSubscription>> Load()
    {
        try
        {
            if (File.Exists(_path))
            {
                var file = JsonSerializer.Deserialize<Dictionary<string, List<PushSubscription>>>(File.ReadAllText(_path), Json);
                if (file is not null)
                {
                    // Users deleted since are dropped (written out with the next change), and entries a hand edit broke.
                    return file
                        .Where(u => Guid.TryParseExact(u.Key, "N", out var id) && _userExists(id) && u.Value is not null)
                        .ToDictionary(
                            u => u.Key,
                            u => u.Value.Where(s => s is { Endpoint: not null, P256dh: not null, Auth: not null, DeviceId: not null }).ToList(),
                            StringComparer.Ordinal);
                }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            // Unreadable: start over. Those devices turn notifications on again the next time they open Lumen.
            _logger.LogWarning("Lumen couldn't read {Path}: {Message}", _path, e.Message);
        }

        return new Dictionary<string, List<PushSubscription>>(StringComparer.Ordinal);
    }

    private void Write()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            var temp = _path + ".tmp";
            using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(stream, _users, Json);

                // On the disk before the move: a power cut then can't leave an empty file in place of the old one.
                stream.Flush(true);
            }

            File.Move(temp, _path, true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Kept in memory: notifications still work until Jellyfin restarts.
            _logger.LogWarning("Lumen couldn't save {Path}: {Message}", _path, e.Message);
        }
    }
}
