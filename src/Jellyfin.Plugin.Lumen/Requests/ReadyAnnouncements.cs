using System.Text.Json;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Which of a user's requests should get a "ready to watch" pop-up.</summary>
public interface IReadyAnnouncements
{
    /// <summary>
    /// Records the user's requests that are still in flight, forgets the ones that were declined or failed, and returns
    /// those of <paramref name="ready"/> seen in flight before and not announced yet.
    /// </summary>
    IReadOnlySet<int> Update(Guid userId, string scope, IEnumerable<int> inFlight, IEnumerable<int> ready, IEnumerable<int> dropped);

    /// <summary>The pop-up for these requests has been shown (on any of the user's devices): never again.</summary>
    void MarkAnnounced(Guid userId, string scope, IEnumerable<int> requestIds);

    /// <summary>
    /// <see cref="Update"/> and <see cref="MarkAnnounced"/> in one step, for a caller that announces them itself (a push
    /// notification): whoever asks next, on any path, isn't given the same requests. If nobody could be told after all,
    /// <see cref="Update"/> with them as <c>inFlight</c> puts them back. <paramref name="named"/> are ready requests to
    /// announce even though Lumen never saw them in flight (Seerr's webhook said they became available), unless the
    /// user was told about them already.
    /// </summary>
    IReadOnlySet<int> Claim(Guid userId, string scope, IEnumerable<int> inFlight, IEnumerable<int> ready, IEnumerable<int> dropped, IEnumerable<int>? named = null);

    /// <summary>Whether Lumen is watching a request of the user's for becoming ready (under any Seerr address).</summary>
    bool IsWatching(Guid userId);
}

/// <summary>
/// Remembers, per Jellyfin user, the Seerr requests Lumen has seen in flight, in a small JSON file in Jellyfin's data
/// folder, so the pop-up shows once per request across reloads, devices and server restarts. Only requests seen in
/// flight are announced: a request that was ready before Lumen first looked (or before this feature) never pops up.
/// The same list serves push notifications (Push/ReadyPushJob), which take a request with <see cref="Claim"/> before
/// sending, so a request is announced by a push or by the pop-up, never both.
/// <para>
/// <c>scope</c> is the Seerr address: request ids are Seerr's, so pointing Lumen at another Seerr starts the user's list
/// over. Each user keeps at most <see cref="MaxPerUser"/> ids (the newest), and users Jellyfin no longer has are left
/// out when the file is read.
/// </para>
/// </summary>
public sealed class ReadyAnnouncements : IReadyAnnouncements
{
    public const int MaxPerUser = 200;

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };
    private readonly Lock _lock = new();
    private readonly string _path;
    private readonly ILogger<ReadyAnnouncements> _logger;
    private readonly Func<Guid, bool> _userExists;
    private Dictionary<string, UserEntry>? _users;

    public ReadyAnnouncements(IApplicationPaths paths, IUserManager users, ILogger<ReadyAnnouncements> logger)
        : this(Path.Combine(paths.DataPath, "lumen", "ready-announcements.json"), logger, id => users.GetUserById(id) is not null)
    {
    }

    internal ReadyAnnouncements(string path, ILogger<ReadyAnnouncements> logger, Func<Guid, bool>? userExists = null)
    {
        _path = path;
        _logger = logger;
        _userExists = userExists ?? (_ => true);
    }

    public IReadOnlySet<int> Update(Guid userId, string scope, IEnumerable<int> inFlight, IEnumerable<int> ready, IEnumerable<int> dropped) =>
        Update(userId, scope, inFlight, ready, dropped, null, false);

    public IReadOnlySet<int> Claim(Guid userId, string scope, IEnumerable<int> inFlight, IEnumerable<int> ready, IEnumerable<int> dropped, IEnumerable<int>? named = null) =>
        Update(userId, scope, inFlight, ready, dropped, named, true);

    public bool IsWatching(Guid userId)
    {
        lock (_lock)
        {
            _users ??= Load();
            return _users.TryGetValue(userId.ToString("N", System.Globalization.CultureInfo.InvariantCulture), out var entry) && entry.Watching.Count > 0;
        }
    }

    public void MarkAnnounced(Guid userId, string scope, IEnumerable<int> requestIds)
    {
        lock (_lock)
        {
            var entry = Entry(userId, scope);
            var changed = false;
            foreach (var id in requestIds)
            {
                changed |= entry.Watching.Remove(id) | entry.Told.Add(id);
            }

            if (changed)
            {
                TrimTold(entry);
                Save();
            }
        }
    }

    private static void TrimTold(UserEntry entry)
    {
        if (entry.Told.Count > MaxPerUser)
        {
            entry.Told = entry.Told.OrderByDescending(id => id).Take(MaxPerUser).ToHashSet();
        }
    }

    private HashSet<int> Update(Guid userId, string scope, IEnumerable<int> inFlight, IEnumerable<int> ready, IEnumerable<int> dropped, IEnumerable<int>? named, bool claim)
    {
        lock (_lock)
        {
            var entry = Entry(userId, scope);
            var changed = false;
            foreach (var id in dropped)
            {
                changed |= entry.Watching.Remove(id);
            }

            // In flight (again, or given back after a push nobody got): due when it's ready, whatever was said before.
            foreach (var id in inFlight)
            {
                changed |= entry.Watching.Add(id) | entry.Told.Remove(id);
            }

            // Named by Seerr's webhook, which may name a request more than once: only what the user hasn't been told.
            foreach (var id in named ?? [])
            {
                changed |= !entry.Told.Contains(id) && entry.Watching.Add(id);
            }

            if (entry.Watching.Count > MaxPerUser)
            {
                entry.Watching = entry.Watching.OrderByDescending(id => id).Take(MaxPerUser).ToHashSet();
                changed = true;
            }

            var announce = ready.Where(entry.Watching.Contains).ToHashSet();
            if (claim && announce.Count > 0)
            {
                entry.Watching.ExceptWith(announce);
                entry.Told.UnionWith(announce);
                TrimTold(entry);
                changed = true;
            }

            if (changed)
            {
                Save();
            }

            return announce;
        }
    }

    private UserEntry Entry(Guid userId, string scope)
    {
        _users ??= Load();
        var key = userId.ToString("N", System.Globalization.CultureInfo.InvariantCulture);
        if (!_users.TryGetValue(key, out var entry) || entry.Scope != scope)
        {
            entry = new UserEntry { Scope = scope };
            _users[key] = entry;
        }

        return entry;
    }

    private Dictionary<string, UserEntry> Load()
    {
        try
        {
            if (File.Exists(_path))
            {
                var file = JsonSerializer.Deserialize<Dictionary<string, UserEntry>>(File.ReadAllText(_path), Json);
                if (file is not null)
                {
                    // Users deleted since are dropped (written out with the next change).
                    return file
                        .Where(u => Guid.TryParseExact(u.Key, "N", out var id) && _userExists(id))
                        .ToDictionary(u => u.Key, u => u.Value, StringComparer.Ordinal);
                }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            // Unreadable: start over. The worst case is a pop-up that doesn't show for requests already in flight.
            _logger.LogWarning("Lumen couldn't read {Path}: {Message}", _path, e.Message);
        }

        return new Dictionary<string, UserEntry>(StringComparer.Ordinal);
    }

    private void Save()
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
            // Kept in memory: the pop-ups still work until Jellyfin restarts.
            _logger.LogWarning("Lumen couldn't save {Path}: {Message}", _path, e.Message);
        }
    }

    private sealed class UserEntry
    {
        public string Scope { get; set; } = string.Empty;

        [System.Diagnostics.CodeAnalysis.SuppressMessage("Usage", "CA2227:Collection properties should be read only", Justification = "JSON.")]
        public HashSet<int> Watching { get; set; } = [];

        /// <summary>
        /// Gets or sets the requests the user was last told about (the newest <see cref="MaxPerUser"/>): what keeps a
        /// request Seerr's webhook names twice from being announced twice. Absent from files written before push
        /// notifications.
        /// </summary>
        [System.Diagnostics.CodeAnalysis.SuppressMessage("Usage", "CA2227:Collection properties should be read only", Justification = "JSON.")]
        public HashSet<int> Told { get; set; } = [];
    }
}
