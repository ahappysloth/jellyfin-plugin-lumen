using Jellyfin.Plugin.Lumen.Home;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class YouTubeIdTests
{
    [Theory]
    [InlineData("https://www.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("http://www.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://m.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://music.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42s")]
    [InlineData("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890#t=10")]
    [InlineData("https://www.youtube.com/watch/?v=dQw4w9WgXcQ")]
    [InlineData("https://youtu.be/dQw4w9WgXcQ")]
    [InlineData("https://youtu.be/dQw4w9WgXcQ?si=abcDEF123&t=5")]
    [InlineData("https://www.youtube.com/embed/dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1")]
    [InlineData("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/v/dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/shorts/dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/live/dQw4w9WgXcQ")]
    [InlineData("  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ")]
    [InlineData("https://www.youtube.com/watch?v=dQw4w9WgXc%51")] // .NET's Uri reads the escaped Q; the id is checked after
    public void FromUrl_ReadsTheId(string url) => Assert.Equal("dQw4w9WgXcQ", YouTubeId.FromUrl(url));

    [Fact]
    public void FromUrl_KeepsTheIdsCase_AndItsDashAndUnderscore() =>
        Assert.Equal("a-B_c9D-e_F", YouTubeId.FromUrl("https://www.youtube.com/watch?v=a-B_c9D-e_F"));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("dQw4w9WgXcQ")] // a bare id is not a URL
    [InlineData("www.youtube.com/watch?v=dQw4w9WgXcQ")] // no scheme
    [InlineData("ftp://www.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://vimeo.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://evilyoutube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://evil.example/https://www.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/watch")]
    [InlineData("https://www.youtube.com/watch?v=")]
    [InlineData("https://www.youtube.com/watch?vv=dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/watch?v=dQw4w9WgXc")] // 10 characters
    [InlineData("https://www.youtube.com/watch?v=dQw4w9WgXcQQ")] // 12
    [InlineData("https://www.youtube.com/watch?v=dQw4w9WgX.Q")]
    [InlineData("https://www.youtube.com/watch?v=dQw4w9W\"XcQ")]
    [InlineData("https://www.youtube.com/watch?v=dQw4w9W%2FXcQ")]
    [InlineData("https://www.youtube.com/embed/dQw4w9WgXcQ/extra")]
    [InlineData("https://www.youtube.com/embed/")]
    [InlineData("https://www.youtube.com/playlist?list=PL1234567890")]
    [InlineData("https://www.youtube.com/channel/dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/@dQw4w9WgXcQ")]
    [InlineData("https://youtu.be/")]
    [InlineData("https://youtu.be/dQw4w9WgXcQ/more")]
    [InlineData("https://youtu.be/watch?v=dQw4w9WgXcQ")]
    public void FromUrl_RejectsEverythingElse(string? url) => Assert.Null(YouTubeId.FromUrl(url));

    [Theory]
    [InlineData("dQw4w9WgXcQ", true)]
    [InlineData("a-B_c9D-e_F", true)]
    [InlineData("dQw4w9WgXc", false)]
    [InlineData("dQw4w9WgXcQQ", false)]
    [InlineData("dQw4w9WgXcQ\n", false)]
    [InlineData("dQw4w9 gXcQ", false)]
    [InlineData("dQw4w9/gXcQ", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsValid_TakesExactlyElevenIdCharacters(string? id, bool expected) => Assert.Equal(expected, YouTubeId.IsValid(id));
}
