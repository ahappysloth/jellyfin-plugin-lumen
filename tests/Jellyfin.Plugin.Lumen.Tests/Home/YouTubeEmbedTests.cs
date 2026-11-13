using Jellyfin.Plugin.Lumen.Home;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class YouTubeEmbedTests
{
    [Theory]
    [InlineData("https://www.youtube-nocookie.com", "https://www.youtube-nocookie.com")]
    [InlineData("https://stub.example:8443/", "https://stub.example:8443")]
    [InlineData("http://localhost:5055", "http://localhost:5055")]
    [InlineData("http://LOCALHOST:5055/", "http://localhost:5055")]
    [InlineData("http://127.0.0.1:5055", "http://127.0.0.1:5055")]
    [InlineData("http://host.docker.internal:5055", "http://host.docker.internal:5055")]
    [InlineData("  http://localhost:5055  ", "http://localhost:5055")]
    public void Normalize_TakesHttpsOrLocalHttp_AsAnOrigin(string value, string expected) => Assert.Equal(expected, YouTubeEmbed.Normalize(value));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("localhost:5055")]
    [InlineData("//localhost:5055")]
    [InlineData("http://example.com")] // plain http, not this machine
    [InlineData("http://localhost.example.com")]
    [InlineData("http://192.168.1.10:5055")]
    [InlineData("ftp://localhost")]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,x")]
    [InlineData("https://user:pass@stub.example")]
    [InlineData("https://stub.example/embed")]
    [InlineData("https://stub.example/?x=1")]
    [InlineData("https://stub.example/#x")]
    public void Normalize_IgnoresAnythingElse(string? value) => Assert.Null(YouTubeEmbed.Normalize(value));
}
