using Jellyfin.Data.Enums;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.Lumen.Storage;

/// <summary>Puts a video stream in its codec, resolution and HDR bucket.</summary>
public static class StorageClassifier
{
    public const string H264 = "H264";
    public const string Hevc = "HEVC";
    public const string Av1 = "AV1";
    public const string Other = "Other";
    public const string Unknown = "Unknown";

    public const string Sd = "SD";
    public const string Hd720 = "720p";
    public const string Hd1080 = "1080p";
    public const string Uhd4K = "4K";

    public static readonly IReadOnlyList<string> CodecKeys = [H264, Hevc, Av1, Other, Unknown];

    public static readonly IReadOnlyList<string> ResolutionKeys = [Sd, Hd720, Hd1080, Uhd4K, Unknown];

    /// <summary>The bucket for an ffprobe codec name (<c>h264</c>, <c>hevc</c>, <c>av1</c>…) or a codec tag.</summary>
    public static string Codec(string? codec) => codec?.Trim().ToLowerInvariant() switch
    {
        null or "" => Unknown,
        "h264" or "avc" or "avc1" or "x264" => H264,
        "hevc" or "h265" or "hvc1" or "hev1" or "x265" => Hevc,
        "av1" or "av01" or "libdav1d" => Av1,
        _ => Other,
    };

    /// <summary>
    /// SD below 720p, then 720p, 1080p and 4K. Width counts as much as height, so a film cropped to 1920×800 is still
    /// 1080p and 3840×1600 is still 4K; a little slack below the nominal width covers 1916- or 3832-wide encodes.
    /// </summary>
    public static string Resolution(int width, int height)
    {
        if (width <= 0 && height <= 0)
        {
            return Unknown;
        }

        if (width >= 3800 || height >= 2160)
        {
            return Uhd4K;
        }

        if (width >= 1900 || height >= 1080)
        {
            return Hd1080;
        }

        return width >= 1260 || height >= 720 ? Hd720 : Sd;
    }

    /// <summary>The stream's HDR format (HDR10, HDR10+, Dolby Vision, HLG, or plain HDR); null for SDR or unknown.</summary>
    public static string? Hdr(MediaStream? video)
    {
        if (video is null)
        {
            return null;
        }

        return video.VideoRangeType switch
        {
            VideoRangeType.HDR10 => "HDR10",
            VideoRangeType.HDR10Plus => "HDR10+",
            VideoRangeType.HLG => "HLG",
            VideoRangeType.DOVI or VideoRangeType.DOVIWithHDR10 or VideoRangeType.DOVIWithHLG or VideoRangeType.DOVIWithSDR
                or VideoRangeType.DOVIWithEL or VideoRangeType.DOVIWithHDR10Plus or VideoRangeType.DOVIWithELHDR10Plus => "Dolby Vision",
            _ => video.VideoRange == VideoRange.HDR ? "HDR" : null,
        };
    }
}
