using Jellyfin.Plugin.Lumen.Storage;
using MediaBrowser.Model.Entities;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Storage;

public class StorageClassifierTests
{
    [Theory]
    [InlineData("h264", "H264")]
    [InlineData("AVC", "H264")]
    [InlineData("hevc", "HEVC")]
    [InlineData("h265", "HEVC")]
    [InlineData("av1", "AV1")]
    [InlineData("vp9", "Other")]
    [InlineData("mpeg2video", "Other")]
    [InlineData(null, "Unknown")]
    [InlineData("", "Unknown")]
    public void Codec(string? codec, string expected) => Assert.Equal(expected, StorageClassifier.Codec(codec));

    [Theory]
    [InlineData(640, 360, "SD")]
    [InlineData(720, 576, "SD")]
    [InlineData(1280, 720, "720p")]
    [InlineData(1280, 534, "720p")] // a widescreen crop of 720p
    [InlineData(960, 720, "720p")] // 4:3
    [InlineData(1920, 1080, "1080p")]
    [InlineData(1920, 800, "1080p")] // cropped 2.40:1
    [InlineData(1916, 798, "1080p")]
    [InlineData(1440, 1080, "1080p")] // anamorphic HDV
    [InlineData(3840, 2160, "4K")]
    [InlineData(3840, 1600, "4K")]
    [InlineData(4096, 1716, "4K")]
    [InlineData(0, 0, "Unknown")]
    public void Resolution(int width, int height, string expected) => Assert.Equal(expected, StorageClassifier.Resolution(width, height));

    [Fact]
    public void Hdr_ReadsJellyfinsVideoRange()
    {
        Assert.Null(StorageClassifier.Hdr(null));
        Assert.Null(StorageClassifier.Hdr(new MediaStream { Type = MediaStreamType.Video, Codec = "h264", BitDepth = 8 }));
        Assert.Equal("HDR10", StorageClassifier.Hdr(Stream("smpte2084")));
        Assert.Equal("HLG", StorageClassifier.Hdr(Stream("arib-std-b67")));

        var hdr10Plus = Stream("smpte2084");
        hdr10Plus.Hdr10PlusPresentFlag = true;
        Assert.Equal("HDR10+", StorageClassifier.Hdr(hdr10Plus));
    }

    private static MediaStream Stream(string transfer) => new()
    {
        Type = MediaStreamType.Video,
        Codec = "hevc",
        BitDepth = 10,
        ColorTransfer = transfer,
        ColorPrimaries = "bt2020",
    };
}
