using Jellyfin.Plugin.Lumen.Trakt;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Trakt;

public class TraktListRefTests
{
    [Theory]
    [InlineData("https://trakt.tv/users/sean/lists/best-of", "users/sean/lists/best-of")]
    [InlineData("https://trakt.tv/users/sean/lists/best-of/", "users/sean/lists/best-of")]
    [InlineData("  https://www.trakt.tv/users/Sean_99/lists/best-of?sort=rank,asc#top ", "users/Sean_99/lists/best-of")]
    [InlineData("https://app.trakt.tv/users/sean/lists/best-of", "users/sean/lists/best-of")]
    [InlineData("http://trakt.tv/users/sean/lists/12345", "users/sean/lists/12345")]
    [InlineData("trakt.tv/users/sean/lists/best-of", "users/sean/lists/best-of")]
    [InlineData("HTTPS://TRAKT.TV/Users/sean/Lists/best-of", "users/sean/lists/best-of")]
    [InlineData("https://trakt.tv/lists/2142753", "lists/2142753")]
    [InlineData("https://trakt.tv/users/sean.k/lists/my.list-2", "users/sean.k/lists/my.list-2")]

    // Dot segments are resolved as a browser would, so they can't climb out of the list's path.
    [InlineData("https://trakt.tv/users/%2E%2E/lists/best-of", "lists/best-of")]
    public void PublicListAddresses_AreRead(string url, string apiPath)
    {
        Assert.True(TraktListRef.TryParse(url, out var list));
        Assert.Equal(apiPath, list.ApiPath);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("best-of")]
    [InlineData("https://trakt.tv/")]
    [InlineData("https://trakt.tv/users/sean")]
    [InlineData("https://trakt.tv/users/sean/lists")]
    [InlineData("https://trakt.tv/users/sean/watchlist")]
    [InlineData("https://trakt.tv/users/sean/lists/best-of/items")]
    [InlineData("https://trakt.tv/movies/inception-2010")]
    [InlineData("https://evil.example/users/sean/lists/best-of")]
    [InlineData("https://trakt.tv.evil.example/users/sean/lists/best-of")]
    [InlineData("https://user:pass@trakt.tv/users/sean/lists/best-of")]
    [InlineData("https://trakt.tv:8443/users/sean/lists/best-of")]
    [InlineData("ftp://trakt.tv/users/sean/lists/best-of")]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://trakt.tv/users/sean/lists/best%20of")]
    [InlineData("https://trakt.tv/users/sean/lists/.hidden")]
    public void AnythingElse_IsNot(string? url)
    {
        Assert.False(TraktListRef.TryParse(url, out var list));
        Assert.Null(list);
    }

    [Fact]
    public void TwoAddressesOfOneList_AreOneList()
    {
        Assert.True(TraktListRef.TryParse("https://trakt.tv/users/sean/lists/best-of", out var a));
        Assert.True(TraktListRef.TryParse("trakt.tv/users/sean/lists/best-of/?sort=added", out var b));

        Assert.Equal(a, b);
        Assert.Equal(TraktQuery.ListItems(a), TraktQuery.ListItems(b));
        Assert.Equal("sean/best-of", a.ToString());
    }
}
