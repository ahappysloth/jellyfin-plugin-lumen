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

    /// <summary>How far along an in-flight state is (higher first when choosing what a title shows); 0 when not in flight.</summary>
    public static int InFlightRank(string state) => state switch
    {
        Downloading => 4,
        Processing => 3,
        Queued => 2,
        Requested => 1,
        _ => 0,
    };
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

    /// <summary>Seerr's MediaStatus AVAILABLE.</summary>
    private const int Available = 5;

    /// <summary>Seerr's MediaStatus DELETED: it was on the server and has been removed.</summary>
    private const int Deleted = 7;

    /// <summary>
    /// The request's progress. <paramref name="memory"/> (already updated with this answer, see
    /// <see cref="DownloadMemory.Observe"/>) counts downloads that have left the queue as done. A show's progress covers
    /// <paramref name="seasons"/>, by default the request's own (Seerr's queue is the whole series').
    /// </summary>
    public static RequestProgressInfo Map(SeerrUserRequest request, DateTimeOffset now, DownloadMemory? memory = null, IReadOnlySet<int>? seasons = null)
    {
        switch (request.Status)
        {
            case SeerrRequestStatus.Declined:
                return new RequestProgressInfo(RequestProgressState.Declined);
            case SeerrRequestStatus.Failed:
                // The request itself (Seerr couldn't hand it to Radarr or Sonarr). A failed download isn't this.
                return new RequestProgressInfo(RequestProgressState.Failed);
            case SeerrRequestStatus.Completed:
                return new RequestProgressInfo(RequestProgressState.Ready);
        }

        if (MediaStatus(request) == Available)
        {
            return new RequestProgressInfo(RequestProgressState.Ready);
        }

        if (request.Status == SeerrRequestStatus.Pending)
        {
            return new RequestProgressInfo(RequestProgressState.Requested);
        }

        seasons ??= SeasonsOf(request);
        var downloads = Downloads(request).Where(d => IsFor(d, seasons)).ToList();

        // Each download once (a season pack is listed per episode). A failed one is a release Radarr or Sonarr gave up on:
        // it's not progress, and the request carries on with the next release they find.
        var current = new Dictionary<string, SeerrDownload>(StringComparer.Ordinal);
        foreach (var download in downloads)
        {
            current.TryAdd(DownloadMemory.Key(download), download);
        }

        var live = current.Values.Where(d => !IsFailed(d)).ToList();
        if (live.Count == 0)
        {
            // Nothing downloading: either nothing has been grabbed yet (or another release is being looked for), or it was
            // and has been imported since.
            return downloads.Count == 0 && memory?.LastQueued(seasons) is { } last && now - last <= ProcessingWindow
                ? new RequestProgressInfo(RequestProgressState.Processing, 100)
                : new RequestProgressInfo(RequestProgressState.Queued);
        }

        double size = 0, left = 0;
        foreach (var download in live)
        {
            size += Math.Max(0, download.Size);
            left += Math.Clamp(download.SizeLeft, 0, Math.Max(0, download.Size));
        }

        // Earlier downloads that left the queue and count as done (see DownloadMemory).
        foreach (var (key, gone) in memory?.Downloads ?? new Dictionary<string, DownloadMemory.Seen>())
        {
            if (!current.ContainsKey(key) && gone.IsFor(seasons))
            {
                size += gone.Size;
            }
        }

        double? percent = size > 0 ? Math.Round((size - left) / size * 100, 1) : null;
        var active = live.Where(d => !IsDone(d)).ToList();
        string state;
        if (active.Count == 0)
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
        var (done, total) = Episodes(downloads, memory, seasons);
        return new RequestProgressInfo(
            state,
            state == RequestProgressState.Processing ? 100 : percent,
            state == RequestProgressState.Downloading ? eta : null,
            total > 1 ? done : null,
            total > 1 ? total : null);
    }

    /// <summary>
    /// Whether Seerr calls the request Completed only because its title was removed from the server (Seerr marks a
    /// request Completed when its media becomes DELETED): it isn't ready to watch, so it's not one to show.
    /// </summary>
    public static bool IsRemoved(SeerrUserRequest request) => request.Status == SeerrRequestStatus.Completed && MediaStatus(request) == Deleted;

    /// <summary>The title's MediaStatus for the request's quality (a 4K request has its own).</summary>
    public static int? MediaStatus(SeerrUserRequest request) => request.Is4k ? request.Media?.Status4k : request.Media?.Status;

    /// <summary>The queue entries for the request's quality (4K requests have their own server), for the whole title.</summary>
    public static IReadOnlyList<SeerrDownload> Downloads(SeerrUserRequest request) =>
        (request.Is4k ? request.Media?.DownloadStatus4k : request.Media?.DownloadStatus) ?? [];

    /// <summary>The seasons a show's request is for; null for a movie, or when Seerr didn't say (then the whole show).</summary>
    public static IReadOnlySet<int>? SeasonsOf(SeerrUserRequest request) =>
        request.Seasons is { Count: > 0 } seasons ? seasons.Select(s => s.SeasonNumber).ToHashSet() : null;

    /// <summary>A release Radarr or Sonarr gave up on (they blocklist it and look for another).</summary>
    internal static bool IsFailed(SeerrDownload download) => IsStatus(download, "failed");

    private static bool IsFor(SeerrDownload download, IReadOnlySet<int>? seasons) =>
        seasons is null || download.Episode is not { } episode || seasons.Contains(episode.SeasonNumber);

    private static bool IsStatus(SeerrDownload download, string status) => string.Equals(download.Status, status, StringComparison.OrdinalIgnoreCase);

    /// <summary>Downloaded and waiting to be imported.</summary>
    private static bool IsDone(SeerrDownload download) =>
        !IsFailed(download) && (IsStatus(download, "completed") || (download.Size > 0 && download.SizeLeft <= 0));

    /// <summary>
    /// A show's episodes (of <paramref name="seasons"/>): those seen in the queue (now, or before and counted as done),
    /// and how many of them are downloaded (left the queue, or finished and waiting there to be imported).
    /// </summary>
    private static (int Done, int Total) Episodes(IReadOnlyList<SeerrDownload> downloads, DownloadMemory? memory, IReadOnlySet<int>? seasons)
    {
        var all = new HashSet<(int, int)>();
        foreach (var seen in memory?.Downloads.Values ?? [])
        {
            all.UnionWith(seen.Episodes.Where(e => seasons is null || seasons.Contains(e.Season)));
        }

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
