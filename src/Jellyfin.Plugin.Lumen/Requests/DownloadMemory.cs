namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>
/// What Lumen has seen of one request's downloads across Seerr's answers. Downloads leave the queue once imported, so
/// without it a show's progress would go backwards as its episodes arrive, and a movie that's been imported but not yet
/// found in the library would look queued again. Not thread-safe: <see cref="RequestProgressService"/> locks around it.
/// </summary>
public sealed class DownloadMemory
{
    private readonly Dictionary<string, double> _sizes = new(StringComparer.Ordinal);
    private readonly HashSet<(int Season, int Episode)> _episodes = [];

    /// <summary>Gets the last time a download for the request was in the queue.</summary>
    public DateTimeOffset? LastQueued { get; private set; }

    /// <summary>Gets the sizes of the downloads seen so far, by download id.</summary>
    public IReadOnlyDictionary<string, double> Sizes => _sizes;

    /// <summary>Gets the episodes seen in the queue so far.</summary>
    public IReadOnlySet<(int Season, int Episode)> Episodes => _episodes;

    /// <summary>Records a Seerr answer's queue entries for the request.</summary>
    public void Observe(IReadOnlyList<SeerrDownload> downloads, DateTimeOffset now)
    {
        if (downloads.Count == 0)
        {
            return;
        }

        LastQueued = now;
        for (var i = 0; i < downloads.Count; i++)
        {
            var download = downloads[i];
            _sizes[RequestProgress.DownloadKey(download, i)] = Math.Max(0, download.Size);
            if (download.Episode is { } episode)
            {
                _episodes.Add((episode.SeasonNumber, episode.EpisodeNumber));
            }
        }
    }
}
