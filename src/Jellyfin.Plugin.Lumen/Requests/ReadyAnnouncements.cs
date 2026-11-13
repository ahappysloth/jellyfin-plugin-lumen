using System.Text.Json;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Which of a user's requests should get a "ready to watch" pop-up.</summary>
public interface IReadyAnnouncements
{
    /// <summary>
    /// Takes Seerr's answer about the user's requests: records those still in flight, forgets every watched request
    /// that's neither in flight nor ready any more (declined, failed, deleted, removed from the server, or past the
    /// newest requests the list covers), and returns those of <paramref name="ready"/> seen in flight before and not
    /// announced yet. <paramref name="waiting"/> are the requests in flight that nothing is expected of soon (see
    /// <see cref="ExpectsSoon"/>).
    /// </summary>
    IReadOnlySet<int> Update(Guid userId, string scope, IEnumerable<int> inFlight, IEnumerable<int> ready, IEnumerable<int> waiting);

    /// <summary>The pop-up for these requests has been shown (on any of the user's devices): never again.</summary>
    void MarkAnnounced(Guid userId, string scope, IEnumerable<int> requestIds);

    /// <summary>
    /// <see cref="Update"/> and <see cref="MarkAnnounced"/> in one step, for a caller that announces them itself (a push
    /// notification): whoever asks next, on any path, isn't given the same requests. If nobody could be told after all,
    /// <see cref="GiveBack"/> or <see cref="Release"/> puts them back. <paramref name="named"/> are ready requests to
    /// announce even though Lumen never saw them in flight (Seerr's webhook said they became available), unless the
    /// user was told about them already. <paramref name="notYet"/> are requests that are ready but not to be announced
    /// yet (the rest of their title is still in flight): they stay watched. Requests left to the pop-up
    /// (<see cref="Release"/>) aren't taken.
    /// </summary>
    IReadOnlySet<int> Claim(Guid userId, string scope, IEnumerable<int> inFlight, IEnumerable<int> ready, IEnumerable<int> waiting, IEnumerable<int>? named = null, IEnumerable<int>? notYet = null);

    /// <summary>Watches these requests for becoming ready: the user just filed them through Lumen.</summary>
    void Watch(Guid userId, string scope, IEnumerable<int> requestIds);

    /// <summary>These requests, taken with <see cref="Claim"/>, weren't announced after all: they're due again, to whoever asks next.</summary>
    void GiveBack(Guid userId, string scope, IEnumerable<int> requestIds);

    /// <summary>
    /// These requests, taken with <see cref="Claim"/>, couldn't be pushed to any device: they're due again, but only to
    /// the pop-up (<see cref="PopUpOnly"/>), so the user hears of them the next time Lumen is open.
    /// </summary>
    void Release(Guid userId, string scope, IEnumerable<int> requestIds);

    /// <summary>The requests left to the pop-up with <see cref="Release"/> and not shown yet.</summary>
    IReadOnlySet<int> PopUpOnly(Guid userId, string scope);

    /// <summary>
    /// Whether Lumen is watching a request of the user's that may become ready any time now (under any Seerr address):
    /// worth asking Seerr about every couple of minutes. Not one that's only waiting.
    /// </summary>
    bool ExpectsSoon(Guid userId);
}

/// <summary>
/// Remembers, per Jellyfin user, the Seerr requests Lumen has seen in flight, in a small JSON file in Jellyfin's data
/// folder, so the pop-up shows once per request across reloads, devices and server restarts. Only requests seen in
/// flight are announced: a request that was ready before Lumen first looked (or before this feature) never pops up.
/// The same list serves push notifications (Push/ReadyPushJob), which take a request with <see cref="Claim"/> before
/// sending, so a request is announced by a push or by the pop-up, never both.
/// <para>
/// A request is watched only while Seerr still lists it in flight or ready: one that was deleted there, or pushed out
/// of the list by newer ones, would otherwise be asked about for ever.
/// </para>
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
    private static readonly IReadOnlySet<int> Empty = new HashSet<int>();
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

    public IReadOnlySet<int> Update(Guid userId, string scope, IEnumerable<int> inFlight, IEnumerable<int> ready, IEnumerable<int> waiting) =>
        Update(userId, scope, inFlight, ready, waiting, null, null, false);

    public IReadOnlySet<int> Claim(Guid userId, string scope, IEnumerable<int> inFlight, IEnumerable<int> ready, IEnumerable<int> waiting, IEnumerable<int>? named = null, IEnumerable<int>? notYet = null) =>
        Update(userId, scope, inFlight, ready, waiting, named, notYet, true);

    public bool ExpectsSoon(Guid userId)
    {
        lock (_lock)
        {
            _users ??= Load();
            return _users.TryGetValue(Key(userId), out var entry) && entry.Watching.Any(id => !entry.Waiting.Contains(id));
        }
    }

    public IReadOnlySet<int> PopUpOnly(Guid userId, string scope)
    {
        lock (_lock)
        {
            return Existing(userId, scope) is { PopUp.Count: > 0 } entry ? entry.PopUp.ToHashSet() : Empty;
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
                changed |= entry.Watching.Remove(id) | entry.Waiting.Remove(id) | entry.PopUp.Remove(id) | entry.Told.Add(id);
            }

            if (changed)
            {
                TrimTold(entry);
                Save();
            }
        }
    }

    public void Watch(Guid userId, string scope, IEnumerable<int> requestIds)
    {
        lock (_lock)
        {
            PutBack(Entry(userId, scope), requestIds, false);
        }
    }

    public void GiveBack(Guid userId, string scope, IEnumerable<int> requestIds) => PutBack(userId, scope, requestIds, false);

    public void Release(Guid userId, string scope, IEnumerable<int> requestIds) => PutBack(userId, scope, requestIds, true);

    private static string Key(Guid userId) => userId.ToString("N", System.Globalization.CultureInfo.InvariantCulture);

    private static void TrimTold(UserEntry entry)
    {
        if (entry.Told.Count > MaxPerUser)
        {
            entry.Told = entry.Told.OrderByDescending(id => id).Take(MaxPerUser).ToHashSet();
        }
    }

    /// <summary>
    /// Requests given back long after they were taken (a push was retried for minutes): if the user's list has started
    /// over since (Lumen was pointed at another Seerr), they're nothing to it, and must not start it over again.
    /// </summary>
    private void PutBack(Guid userId, string scope, IEnumerable<int> requestIds, bool popUpOnly)
    {
        lock (_lock)
        {
            if (Existing(userId, scope) is { } entry)
            {
                PutBack(entry, requestIds, popUpOnly);
            }
        }
    }

    private void PutBack(UserEntry entry, IEnumerable<int> requestIds, bool popUpOnly)
    {
        var changed = false;
        foreach (var id in requestIds)
        {
            changed |= entry.Watching.Add(id) | entry.Told.Remove(id) | (popUpOnly && entry.PopUp.Add(id));
        }

        if (changed)
        {
            Save();
        }
    }

    private HashSet<int> Update(Guid userId, string scope, IEnumerable<int> inFlight, IEnumerable<int> ready, IEnumerable<int> waiting, IEnumerable<int>? named, IEnumerable<int>? notYet, bool claim)
    {
        lock (_lock)
        {
            var entry = Entry(userId, scope);
            var changed = false;
            var readyNow = ready.ToHashSet();

            // What Seerr still lists as in flight or ready: all a watched request can be.
            var listed = new HashSet<int>(readyNow);
            listed.UnionWith(notYet ?? []);

            // In flight (again, or for the first time): due when it's ready, whatever was said before.
            foreach (var id in inFlight)
            {
                listed.Add(id);
                changed |= entry.Watching.Add(id) | entry.Told.Remove(id) | entry.PopUp.Remove(id);
            }

            // Named by Seerr's webhook, which may name a request more than once: only what the user hasn't been told.
            foreach (var id in named ?? [])
            {
                changed |= !entry.Told.Contains(id) && entry.Watching.Add(id);
            }

            // No longer in Seerr's answer, or there as declined or failed: nothing to wait for, so it isn't watched (and
            // its user isn't asked about every pass) any more.
            changed |= entry.Watching.RemoveWhere(id => !listed.Contains(id)) > 0;
            if (entry.Watching.Count > MaxPerUser)
            {
                entry.Watching = entry.Watching.OrderByDescending(id => id).Take(MaxPerUser).ToHashSet();
                changed = true;
            }

            changed |= entry.PopUp.RemoveWhere(id => !entry.Watching.Contains(id)) > 0;
            var waitingNow = waiting.Where(entry.Watching.Contains).ToHashSet();
            if (!waitingNow.SetEquals(entry.Waiting))
            {
                entry.Waiting = waitingNow;
                changed = true;
            }

            // A push takes everything that's due but what was left to the pop-up; the pop-up is offered all of it.
            var announce = readyNow.Where(id => entry.Watching.Contains(id) && !(claim && entry.PopUp.Contains(id))).ToHashSet();
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

    /// <summary>The user's list under this Seerr address, or null if they have none (the caller holds the lock).</summary>
    private UserEntry? Existing(Guid userId, string scope)
    {
        _users ??= Load();
        return _users.TryGetValue(Key(userId), out var entry) && entry.Scope == scope ? entry : null;
    }

    private UserEntry Entry(Guid userId, string scope)
    {
        _users ??= Load();
        var key = Key(userId);
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

        /// <summary>
        /// Gets or sets those of <see cref="Watching"/> that nothing is expected of soon (waiting for approval, or for a
        /// release, for over a day): the push job looks at them every half hour, not every pass.
        /// </summary>
        [System.Diagnostics.CodeAnalysis.SuppressMessage("Usage", "CA2227:Collection properties should be read only", Justification = "JSON.")]
        public HashSet<int> Waiting { get; set; } = [];

        /// <summary>
        /// Gets or sets those of <see cref="Watching"/> the push job gave up on (no device could be reached): due for the
        /// pop-up only, even for a user with notifications on.
        /// </summary>
        [System.Diagnostics.CodeAnalysis.SuppressMessage("Usage", "CA2227:Collection properties should be read only", Justification = "JSON.")]
        public HashSet<int> PopUp { get; set; } = [];
    }
}
