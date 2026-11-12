using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.MediaInfo;

namespace Jellyfin.Plugin.Lumen.Storage;

/// <summary>
/// Adds up video files into a <see cref="StorageReportDto"/>. Each version of a title (each of its media sources) is a
/// file; a file is counted once however many items or libraries reach it. Pure: the scan hands it items and their media
/// sources, and the tests do the same with fakes.
/// </summary>
internal sealed class StorageAggregator
{
    /// <summary>How many movies and series the biggest-titles lists keep.</summary>
    public const int TopCount = 15;

    /// <summary>Library types that hold video; others show only when video turns up in them anyway (mixed folders).</summary>
    private static readonly HashSet<string> VideoLibraryTypes = new(StringComparer.OrdinalIgnoreCase) { "movies", "tvshows" };

    private readonly Func<string, long?> _sizeOnDisk;
    private readonly Tally _all = new();
    private readonly List<Library> _libraries = [];
    private readonly Dictionary<Guid, Library> _librariesById = [];
    private readonly HashSet<string> _seenFiles = new(StringComparer.Ordinal);
    private readonly HashSet<Guid> _seenItems = [];
    private readonly List<StorageMovieDto> _movies = [];
    private readonly Dictionary<Guid, SeriesTally> _series = [];

    /// <param name="sizeOnDisk">The size of a local file Jellyfin has no size for (null when it can't be read).</param>
    public StorageAggregator(Func<string, long?>? sizeOnDisk = null)
    {
        _sizeOnDisk = sizeOnDisk ?? (_ => null);
    }

    /// <summary>Whether an item is a video file of its own: not a trailer or other extra, not a missing episode, and not
    /// an alternate version (its primary's media sources include it).</summary>
    public static bool Counts(BaseItem item) =>
        item is Video video
        && item is not Trailer
        && item.ExtraType is null
        && item.OwnerId == Guid.Empty
        && !item.IsVirtualItem
        && !item.IsFolder
        && video.PrimaryVersionId is null;

    public void AddLibrary(Guid id, string name, string? collectionType)
    {
        if (_librariesById.ContainsKey(id))
        {
            return;
        }

        var library = new Library(id, name, collectionType);
        _libraries.Add(library);
        _librariesById[id] = library;
    }

    /// <param name="item">A movie, episode or other video (see <see cref="Counts"/>; others are skipped).</param>
    /// <param name="sources">Its media sources: one per version.</param>
    /// <param name="libraryIds">The libraries it's in (usually one; overlapping folders can make it more).</param>
    public void Add(BaseItem item, IReadOnlyList<MediaSourceInfo> sources, IEnumerable<Guid> libraryIds)
    {
        if (!Counts(item) || !_seenItems.Add(item.Id))
        {
            return;
        }

        var files = Files(item, sources).Where(f => _seenFiles.Add(f.Key)).ToList();
        if (files.Count == 0)
        {
            return;
        }

        var libraries = libraryIds.Distinct().Select(id => _librariesById.GetValueOrDefault(id)).OfType<Library>().ToList();
        foreach (var file in files)
        {
            _all.Add(file);
            foreach (var library in libraries)
            {
                library.Tally.Add(file);
            }
        }

        var size = files.Sum(f => f.Size ?? 0);
        if (item is Movie)
        {
            // The largest version describes the movie (its other versions are usually smaller copies).
            var main = files.OrderByDescending(f => f.Size ?? 0).First();
            _movies.Add(new StorageMovieDto(
                item.Id,
                item.Name,
                item.ProductionYear,
                size,
                files.Count,
                main.Codec,
                main.CodecName,
                main.Resolution,
                main.Width > 0 ? main.Width : null,
                main.Height > 0 ? main.Height : null,
                main.Bitrate,
                main.Hdr));
        }
        else if (item is Episode episode && episode.SeriesId != Guid.Empty)
        {
            if (!_series.TryGetValue(episode.SeriesId, out var series))
            {
                series = new SeriesTally(episode.SeriesName ?? item.Name);
                _series[episode.SeriesId] = series;
            }

            series.Episodes++;
            foreach (var file in files)
            {
                series.Add(file);
            }
        }
    }

    public StorageReportDto Build(DateTimeOffset computedAt, double seconds) => new(
        computedAt,
        seconds,
        _all.ToDto(),
        _libraries
            .Where(l => l.Tally.Files > 0 || VideoLibraryTypes.Contains(l.CollectionType ?? string.Empty))
            .Select(l => new StorageLibraryDto(l.Id, l.Name, l.CollectionType, l.Tally.ToDto()))
            .ToList(),
        _movies
            .Where(m => m.Size > 0)
            .OrderByDescending(m => m.Size)
            .ThenBy(m => m.Name, StringComparer.OrdinalIgnoreCase)
            .Take(TopCount)
            .ToList(),
        _series
            .Where(s => s.Value.Size > 0)
            .OrderByDescending(s => s.Value.Size)
            .ThenBy(s => s.Value.Name, StringComparer.OrdinalIgnoreCase)
            .Take(TopCount)
            .Select(s => new StorageSeriesDto(
                s.Key,
                s.Value.Name,
                s.Value.Episodes,
                s.Value.Size,
                s.Value.Files,
                s.Value.Codecs.Values.Where(b => b.Files > 0).OrderByDescending(b => b.Size).Select(b => b.ToDto()).ToList()))
            .ToList());

    /// <summary>The item's files: one per media source, or the item itself when Jellyfin lists none.</summary>
    private IEnumerable<FileFacts> Files(BaseItem item, IReadOnlyList<MediaSourceInfo> sources)
    {
        if (sources.Count == 0)
        {
            // A .strm (a shortcut) points at a URL; any other rooted path is a local file.
            var localFile = !item.IsShortcut && !string.IsNullOrEmpty(item.Path) && System.IO.Path.IsPathRooted(item.Path);
            yield return Facts(item.Path ?? item.Id.ToString("N"), item.Size, localFile, item.Path, null, item.Width, item.Height, null, item.RunTimeTicks);
            yield break;
        }

        for (var i = 0; i < sources.Count; i++)
        {
            var source = sources[i];

            // The item's own width and height stand in for its first source's when that has no video stream info.
            var own = i == 0;
            var key = string.IsNullOrEmpty(source.Path) ? (source.Id ?? $"{item.Id:N}/{i}") : source.Path;
            var local = source.Protocol == MediaProtocol.File && !source.IsRemote;
            yield return Facts(
                key,
                source.Size,
                local,
                source.Path,
                source.VideoStream,
                own ? item.Width : 0,
                own ? item.Height : 0,
                source.Bitrate,
                source.RunTimeTicks ?? item.RunTimeTicks);
        }
    }

    private FileFacts Facts(
        string key,
        long? size,
        bool local,
        string? path,
        MediaBrowser.Model.Entities.MediaStream? video,
        int itemWidth,
        int itemHeight,
        int? bitrate,
        long? runTimeTicks)
    {
        // .strm files and other remote sources have no size of their own; a local file Jellyfin hasn't sized is read
        // from disk.
        long? known = size > 0 ? size : null;
        if (known is null && local && !string.IsNullOrEmpty(path))
        {
            known = _sizeOnDisk(path) is > 0 and var onDisk ? onDisk : null;
        }

        var width = video?.Width ?? 0;
        var height = video?.Height ?? 0;
        if (width <= 0 && height <= 0)
        {
            width = itemWidth;
            height = itemHeight;
        }

        long? rate = bitrate > 0 ? bitrate : video?.BitRate > 0 ? video.BitRate : null;
        if (rate is null && known is not null && runTimeTicks > 0)
        {
            rate = (long)(known.Value * 8 / TimeSpan.FromTicks(runTimeTicks.Value).TotalSeconds);
        }

        return new FileFacts(
            key,
            known,
            StorageClassifier.Codec(video?.Codec),
            string.IsNullOrEmpty(video?.Codec) ? null : video.Codec,
            StorageClassifier.Resolution(width, height),
            width,
            height,
            rate,
            StorageClassifier.Hdr(video));
    }

    private sealed record FileFacts(
        string Key,
        long? Size,
        string Codec,
        string? CodecName,
        string Resolution,
        int Width,
        int Height,
        long? Bitrate,
        string? Hdr);

    private sealed class Bucket(string key)
    {
        public long Size { get; private set; }

        public int Files { get; private set; }

        public int UnknownSizeFiles { get; private set; }

        public void Add(long? size)
        {
            Files++;
            if (size is { } known)
            {
                Size += known;
            }
            else
            {
                UnknownSizeFiles++;
            }
        }

        public StorageBucketDto ToDto() => new(key, Size, Files, UnknownSizeFiles);
    }

    private sealed class Tally
    {
        private readonly Bucket _all = new("All");
        private readonly Dictionary<string, Bucket> _codecs = StorageClassifier.CodecKeys.ToDictionary(k => k, k => new Bucket(k));
        private readonly Dictionary<string, Bucket> _resolutions = StorageClassifier.ResolutionKeys.ToDictionary(k => k, k => new Bucket(k));
        private readonly Bucket _hdr = new("HDR");
        private readonly Bucket _h264Pool = new("H264AtLeast1080p");

        public int Files => _all.Files;

        public void Add(FileFacts file)
        {
            _all.Add(file.Size);
            _codecs[file.Codec].Add(file.Size);
            _resolutions[file.Resolution].Add(file.Size);
            if (file.Hdr is not null)
            {
                _hdr.Add(file.Size);
            }

            if (file.Codec == StorageClassifier.H264 && file.Resolution is StorageClassifier.Hd1080 or StorageClassifier.Uhd4K)
            {
                _h264Pool.Add(file.Size);
            }
        }

        public StorageBreakdownDto ToDto() => new(
            _all.Size,
            _all.Files,
            _all.UnknownSizeFiles,
            StorageClassifier.CodecKeys.Select(k => _codecs[k].ToDto()).ToList(),
            StorageClassifier.ResolutionKeys.Select(k => _resolutions[k].ToDto()).ToList(),
            _hdr.ToDto(),
            _h264Pool.ToDto());
    }

    private sealed class Library(Guid id, string name, string? collectionType)
    {
        public Guid Id { get; } = id;

        public string Name { get; } = name;

        public string? CollectionType { get; } = collectionType;

        public Tally Tally { get; } = new();
    }

    private sealed class SeriesTally(string name)
    {
        public string Name { get; } = name;

        public int Episodes { get; set; }

        public long Size { get; private set; }

        public int Files { get; private set; }

        public Dictionary<string, Bucket> Codecs { get; } = [];

        public void Add(FileFacts file)
        {
            Files++;
            Size += file.Size ?? 0;
            if (!Codecs.TryGetValue(file.Codec, out var bucket))
            {
                bucket = new Bucket(file.Codec);
                Codecs[file.Codec] = bucket;
            }

            bucket.Add(file.Size);
        }
    }
}
