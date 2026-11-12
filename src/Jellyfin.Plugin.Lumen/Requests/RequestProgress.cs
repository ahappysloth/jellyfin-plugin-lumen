namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Where one of the user's requests stands, as the request progress design note (2026-11-12) defines it.</summary>
public static class RequestProgressState
{
    /// <summary>Waiting for an admin's approval.</summary>
    public const string Requested = "Requested";

    /// <summary>Approved, nothing downloading yet (Radarr/Sonarr are looking for a release, or a download is waiting to start).</summary>
    public const string Queued = "Queued";

    public const string Downloading = "Downloading";

    /// <summary>Downloaded; being imported and added to the library.</summary>
    public const string Processing = "Processing";

    /// <summary>On the server.</summary>
    public const string Ready = "Ready";

    public const string Declined = "Declined";

    public const string Failed = "Failed";

    /// <summary>Whether the request may still change on its own (worth checking on again).</summary>
    public static bool IsInFlight(string state) => state is Requested or Queued or Downloading or Processing;
}

/// <summary>
/// A request's progress when Seerr answered: <see cref="Eta"/> stays a time, so each response can say how long is left
/// at that moment (see <see cref="SecondsLeftAt"/>). <see cref="Percent"/> is null without a download to measure.
/// </summary>
public sealed record RequestProgressInfo(string State, double? Percent = null, DateTimeOffset? Eta = null, int? EpisodesDone = null, int? EpisodesTotal = null)
{
    /// <summary>Whole seconds from <paramref name="now"/> to <see cref="Eta"/>, while downloading; null when unknown or past.</summary>
    public int? SecondsLeftAt(DateTimeOffset now) =>
        State == RequestProgressState.Downloading && Eta is { } eta && eta > now
            ? (int)Math.Min(int.MaxValue, Math.Ceiling((eta - now).TotalSeconds))
            : null;
}

/// <summary>Turns one of Seerr's requests (with its media's download queue) into a <see cref="RequestProgressInfo"/>.</summary>
public static class RequestProgress
{
    /// <summary>
    /// How long after its last download left the queue a request counts as Processing (imported, waiting for Seerr's
    /// library scan, which runs every few minutes) rather than Queued again.
    /// </summary>
    public static readonly TimeSpan ProcessingWindow = TimeSpan.FromHours(6);

    /// <summary>
    /// The request's progress. <paramref name="memory"/> (already updated with this answer, see
    /// <see cref="DownloadMemory.Observe"/>) counts downloads that have left the queue as done.
    /// </summary>
    public static RequestProgressInfo Map(SeerrUserRequest request, DateTimeOffset now, DownloadMemory? memory = null)
    {
        switch (request.Status)
        {
            case SeerrRequestStatus.Declined:
                return new RequestProgressInfo(RequestProgressState.Declined);
            case SeerrRequestStatus.Failed:
                return new RequestProgressInfo(RequestProgressState.Failed);
            case SeerrRequestStatus.Completed:
                return new RequestProgressInfo(RequestProgressState.Ready);
        }

        var media = request.Media;
        if (media?.Status == 5)
        {
            return new RequestProgressInfo(RequestProgressState.Ready);
        }

        if (request.Status == SeerrRequestStatus.Pending)
        {
            return new RequestProgressInfo(RequestProgressState.Requested);
        }

        var downloads = Downloads(request);
        if (downloads.Count == 0)
        {
            // Nothing in the queue: either nothing has been grabbed yet, or it was and has been imported since.
            return memory?.LastQueued is { } last && now - last <= ProcessingWindow
                ? new RequestProgressInfo(RequestProgressState.Processing, 100)
                : new RequestProgressInfo(RequestProgressState.Queued);
        }

        // Bytes: each download once (a season pack is listed per episode), plus earlier ones that have left the queue.
        var current = new Dictionary<string, SeerrDownload>(StringComparer.Ordinal);
        for (var i = 0; i < downloads.Count; i++)
        {
            current.TryAdd(DownloadKey(downloads[i], i), downloads[i]);
        }

        double size = 0, left = 0;
        foreach (var download in current.Values)
        {
            size += Math.Max(0, download.Size);
            left += Math.Clamp(download.SizeLeft, 0, Math.Max(0, download.Size));
        }

        foreach (var (key, gone) in memory?.Sizes ?? new Dictionary<string, double>())
        {
            if (!current.ContainsKey(key))
            {
                size += gone;
            }
        }

        double? percent = size > 0 ? Math.Round((size - left) / size * 100, 1) : null;
        var active = current.Values.Where(d => !IsDone(d)).ToList();
        string state;
        if (current.Values.All(d => IsStatus(d, "failed")))
        {
            state = RequestProgressState.Failed;
        }
        else if (active.Count == 0)
        {
            state = RequestProgressState.Processing;
        }
        else if (active.Any(d => IsStatus(d, "downloading") || d.SizeLeft < d.Size) || percent > 0)
        {
            state = RequestProgressState.Downloading;
        }
        else
        {
            state = RequestProgressState.Queued;
        }

        // The download that will finish last decides when it's all in.
        var eta = active
            .Select(d => d.EstimatedCompletionTime)
            .Where(t => t > now)
            .Max();
        var (done, total) = Episodes(downloads, memory);
        return new RequestProgressInfo(
            state,
            state == RequestProgressState.Failed ? null : state == RequestProgressState.Processing ? 100 : percent,
            state == RequestProgressState.Downloading ? eta : null,
            total > 1 ? done : null,
            total > 1 ? total : null);
    }

    /// <summary>The queue entries for the request's quality (4K requests have their own server).</summary>
    public static IReadOnlyList<SeerrDownload> Downloads(SeerrUserRequest request) =>
        (request.Is4k ? request.Media?.DownloadStatus4k : request.Media?.DownloadStatus) ?? [];

    /// <summary>What identifies a download: its id, or its place in the list when the client gave none.</summary>
    internal static string DownloadKey(SeerrDownload download, int index) =>
        string.IsNullOrEmpty(download.DownloadId) ? "#" + index.ToString(System.Globalization.CultureInfo.InvariantCulture) : download.DownloadId;

    private static bool IsStatus(SeerrDownload download, string status) => string.Equals(download.Status, status, StringComparison.OrdinalIgnoreCase);

    /// <summary>Downloaded and waiting to be imported.</summary>
    private static bool IsDone(SeerrDownload download) => IsStatus(download, "completed") || (download.Size > 0 && download.SizeLeft <= 0);

    /// <summary>
    /// A show's episodes: those seen in the queue (now or before), and how many of them are downloaded (left the queue,
    /// or finished and waiting there to be imported).
    /// </summary>
    private static (int Done, int Total) Episodes(IReadOnlyList<SeerrDownload> downloads, DownloadMemory? memory)
    {
        var all = new HashSet<(int, int)>(memory?.Episodes ?? new HashSet<(int Season, int Episode)>());
        var pending = new HashSet<(int, int)>();
        foreach (var download in downloads)
        {
            if (download.Episode is not { } episode)
            {
                continue;
            }

            var key = (episode.SeasonNumber, episode.EpisodeNumber);
            all.Add(key);
            if (!IsDone(download))
            {
                pending.Add(key);
            }
        }

        return (all.Count - pending.Count, all.Count);
    }
}
