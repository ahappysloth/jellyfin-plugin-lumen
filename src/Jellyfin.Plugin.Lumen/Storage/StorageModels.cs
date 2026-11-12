namespace Jellyfin.Plugin.Lumen.Storage;

/// <summary>Where a storage report stands: <see cref="StorageState"/> says whether <c>Report</c> is current.</summary>
/// <param name="State">Ready, Computing (a scan is running; Report is the previous one, if any) or Failed.</param>
/// <param name="Report">The latest finished report; null until the first scan finishes.</param>
/// <param name="Error">Why the last scan failed (Failed only).</param>
public sealed record StorageStatusDto(string State, StorageReportDto? Report, string? Error);

/// <summary>The states of <see cref="StorageStatusDto.State"/>.</summary>
public static class StorageState
{
    public const string Ready = "Ready";
    public const string Computing = "Computing";
    public const string Failed = "Failed";
}

/// <summary>Where the space goes: video files by library, codec and resolution, and the biggest titles.</summary>
/// <param name="ComputedAt">When the scan finished.</param>
/// <param name="Seconds">How long it took.</param>
/// <param name="Totals">Every video file in every library, counted once.</param>
/// <param name="Libraries">Each library with video in it, in the server's order.</param>
/// <param name="BiggestMovies">The largest movies, all their versions together.</param>
/// <param name="BiggestSeries">The largest series, all their episodes together.</param>
public sealed record StorageReportDto(
    DateTimeOffset ComputedAt,
    double Seconds,
    StorageBreakdownDto Totals,
    IReadOnlyList<StorageLibraryDto> Libraries,
    IReadOnlyList<StorageMovieDto> BiggestMovies,
    IReadOnlyList<StorageSeriesDto> BiggestSeries);

/// <summary>Sizes and file counts, split by video codec and resolution.</summary>
/// <param name="Size">Bytes, over the files whose size is known.</param>
/// <param name="Files">Video files (each version of a title is a file).</param>
/// <param name="UnknownSizeFiles">Files without a size (.strm and other remote files), counted but not sized.</param>
/// <param name="Codecs">Keyed H264, HEVC, AV1, Other, Unknown (no video stream info), always in that order.</param>
/// <param name="Resolutions">Keyed SD, 720p, 1080p, 4K, Unknown, always in that order.</param>
/// <param name="Hdr">HDR10, HDR10+, Dolby Vision and HLG files.</param>
/// <param name="H264AtLeast1080p">H.264 files at 1080p or 4K: the usual pool of re-encode candidates.</param>
public sealed record StorageBreakdownDto(
    long Size,
    int Files,
    int UnknownSizeFiles,
    IReadOnlyList<StorageBucketDto> Codecs,
    IReadOnlyList<StorageBucketDto> Resolutions,
    StorageBucketDto Hdr,
    StorageBucketDto H264AtLeast1080p);

/// <summary>One slice of a breakdown.</summary>
public sealed record StorageBucketDto(string Key, long Size, int Files, int UnknownSizeFiles);

public sealed record StorageLibraryDto(Guid Id, string Name, string? CollectionType, StorageBreakdownDto Storage);

/// <summary>A movie, all its versions together; codec, resolution, bitrate and HDR are its largest version's.</summary>
/// <param name="Id">The movie's item id (its details page).</param>
/// <param name="Name">Its title.</param>
/// <param name="Year">Its production year.</param>
/// <param name="Size">Bytes, all versions together.</param>
/// <param name="Files">Its versions.</param>
/// <param name="Codec">The codec bucket (see <see cref="StorageBreakdownDto.Codecs"/>).</param>
/// <param name="CodecName">The codec as ffprobe names it (<c>vp9</c>), so "Other" can say which.</param>
/// <param name="Resolution">The resolution bucket (see <see cref="StorageBreakdownDto.Resolutions"/>).</param>
/// <param name="Width">The video's width in pixels.</param>
/// <param name="Height">The video's height in pixels.</param>
/// <param name="Bitrate">Bits per second.</param>
/// <param name="Hdr">HDR10, HDR10+, Dolby Vision, HLG or HDR; null for SDR.</param>
public sealed record StorageMovieDto(
    Guid Id,
    string Name,
    int? Year,
    long Size,
    int Files,
    string Codec,
    string? CodecName,
    string Resolution,
    int? Width,
    int? Height,
    long? Bitrate,
    string? Hdr);

/// <summary>A series, all its episodes together.</summary>
/// <param name="Id">The series' item id (its details page).</param>
/// <param name="Name">Its name.</param>
/// <param name="Episodes">Episodes with a file.</param>
/// <param name="Size">Bytes, all episodes together.</param>
/// <param name="Files">Episode files (more than episodes when some have several versions).</param>
/// <param name="Codecs">Its codecs by size, largest first; only those it has.</param>
public sealed record StorageSeriesDto(Guid Id, string Name, int Episodes, long Size, int Files, IReadOnlyList<StorageBucketDto> Codecs);
