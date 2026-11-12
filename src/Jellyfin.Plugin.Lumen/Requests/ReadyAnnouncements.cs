using System.Text.Json;
using MediaBrowser.Common.Configuration;
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
}

/// <summary>
/// Remembers, per Jellyfin user, the Seerr requests Lumen has seen in flight, in a small JSON file in Jellyfin's data
/// folder, so the pop-up shows once per request across reloads, devices and server restarts. Only requests seen in
/// flight are announced: a request that was ready before Lumen first looked (or before this feature) never pops up.
/// <para>
/// <c>scope</c> is the Seerr address: request ids are Seerr's, so pointing Lumen at another Seerr starts the user's list
/// over. Each user keeps at most <see cref="MaxPerUser"/> ids (the newest).
/// </para>
/// </summary>
public sealed class ReadyAnnouncements : IReadyAnnouncements
{
    public const int MaxPerUser = 200;

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };
    private readonly Lock _lock = new();
    private readonly string _path;
    private readonly ILogger<ReadyAnnouncements> _logger;
    private Dictionary<string, UserEntry>? _users;

    public ReadyAnnouncements(IApplicationPaths paths, ILogger<ReadyAnnouncements> logger)
        : this(Path.Combine(paths.DataPath, "lumen", "ready-announcements.json"), logger)
    {
    }

    internal ReadyAnnouncements(string path, ILogger<ReadyAnnouncements> logger)
    {
        _path = path;
        _logger = logger;
    }

    public IReadOnlySet<int> Update(Guid userId, string scope, IEnumerable<int> inFlight, IEnumerable<int> ready, IEnumerable<int> dropped)
    {
        lock (_lock)
        {
            var entry = Entry(userId, scope);
            var changed = false;
            foreach (var id in dropped)
            {
                changed |= entry.Watching.Remove(id);
            }

            foreach (var id in inFlight)
            {
                changed |= entry.Watching.Add(id);
            }

            if (entry.Watching.Count > MaxPerUser)
            {
                entry.Watching = entry.Watching.OrderByDescending(id => id).Take(MaxPerUser).ToHashSet();
                changed = true;
            }

            if (changed)
            {
                Save();
            }

            return ready.Where(entry.Watching.Contains).ToHashSet();
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
                changed |= entry.Watching.Remove(id);
            }

            if (changed)
            {
                Save();
            }
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
                    return file;
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
            File.WriteAllText(temp, JsonSerializer.Serialize(_users, Json));
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
    }
}
