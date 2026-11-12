using System.Globalization;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>
/// What Lumen has seen of one title's download queue (for one quality) across Seerr's answers. Downloads leave the queue
/// once imported, so without it a show's progress would go backwards as its episodes arrive, and a movie that's been
/// imported but not yet found in the library would look queued again. Not thread-safe: <see cref="RequestProgressService"/>
/// locks around it.
/// <para>
/// A download that left the queue counts as done, since Lumen only looks while someone's watching the progress and a
/// download often finishes and is imported between two looks. Except when it can't have been: it was last seen failed,
/// or it left unfinished and another download now covers the same thing (a re-grab: Radarr or Sonarr gave up on that
/// release and took another). Those are forgotten, so a replaced 8 GB release doesn't count as 8 GB done.
/// </para>
/// </summary>
public sealed class DownloadMemory
{
    /// <summary>How much may be left of a download that left the queue for it to count as finished whatever replaced it.</summary>
    private const double FinishedShare = 0.01;

    private readonly Dictionary<string, Seen> _downloads = new(StringComparer.Ordinal);

    /// <summary>Gets the downloads seen so far (still in the queue, or gone and counted as done), by <see cref="Key"/>.</summary>
    public IReadOnlyDictionary<string, Seen> Downloads => _downloads;

    /// <summary>
    /// What identifies a download across answers: the download client's id, else the release's name and episode (the
    /// queue's order changes as entries leave, so never a position in it).
    /// </summary>
    public static string Key(SeerrDownload download)
    {
        if (!string.IsNullOrEmpty(download.DownloadId))
        {
            return download.DownloadId;
        }

        var episode = download.Episode is { } e
            ? string.Create(CultureInfo.InvariantCulture, $"{e.SeasonNumber}x{e.EpisodeNumber}")
            : "-";
        return "title:" + (download.Title ?? string.Empty) + "|" + episode;
    }

    /// <summary>Records a Seerr answer's queue entries for the title (an empty queue too: it says what's gone).</summary>
    public void Observe(IReadOnlyList<SeerrDownload> downloads, DateTimeOffset now)
    {
        // A season pack is listed once per episode, with the same id and the whole pack's size: one entry with all of them.
        var current = new Dictionary<string, Seen>(StringComparer.Ordinal);
        foreach (var download in downloads)
        {
            var key = Key(download);
            var episodes = current.TryGetValue(key, out var pack) ? new HashSet<(int, int)>(pack.Episodes) : [];
            if (download.Episode is { } episode)
            {
                episodes.Add((episode.SeasonNumber, episode.EpisodeNumber));
            }

            var size = Math.Max(0, download.Size);
            current[key] = new Seen(size, Math.Clamp(download.SizeLeft, 0, size), RequestProgress.IsFailed(download), episodes, now);
        }

        foreach (var (key, seen) in _downloads.ToList())
        {
            if (current.ContainsKey(key))
            {
                continue;
            }

            if (seen.Failed || (!seen.Finished && current.Values.Any(c => c.Covers(seen))))
            {
                _downloads.Remove(key);
            }
        }

        foreach (var (key, seen) in current)
        {
            // A pack's episodes as seen over time (Sonarr may list some of them only once they start).
            var episodes = _downloads.TryGetValue(key, out var before) ? new HashSet<(int, int)>(before.Episodes.Concat(seen.Episodes)) : seen.Episodes;
            _downloads[key] = seen with { Episodes = episodes };
        }
    }

    /// <summary>The last time a download for <paramref name="seasons"/> (null: any) was in the queue, among those that count.</summary>
    public DateTimeOffset? LastQueued(IReadOnlySet<int>? seasons) =>
        _downloads.Values.Where(d => d.IsFor(seasons)).Select(d => (DateTimeOffset?)d.LastSeen).Max();

    /// <summary>One download as last seen: its bytes, whether it had failed, and the episodes it holds (none for a movie).</summary>
    public sealed record Seen(double Size, double Left, bool Failed, IReadOnlySet<(int Season, int Episode)> Episodes, DateTimeOffset LastSeen)
    {
        /// <summary>Gets a value indicating whether it was (all but) downloaded when last seen.</summary>
        public bool Finished => !Failed && Size > 0 && Left <= Size * FinishedShare;

        /// <summary>Whether this download is for one of <paramref name="seasons"/> (null: the whole title).</summary>
        public bool IsFor(IReadOnlySet<int>? seasons) => seasons is null || Episodes.Count == 0 || Episodes.Any(e => seasons.Contains(e.Season));

        /// <summary>Whether this download replaces <paramref name="other"/>: a movie's, or one with an episode in common.</summary>
        internal bool Covers(Seen other) => other.Episodes.Count == 0 || Episodes.Overlaps(other.Episodes);
    }
}
