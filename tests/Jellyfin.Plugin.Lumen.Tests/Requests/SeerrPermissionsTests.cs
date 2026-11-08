using Jellyfin.Plugin.Lumen.Requests;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public class SeerrPermissionsTests
{
    [Theory]
    [InlineData(0L, false, false)]
    [InlineData(2L, true, true)] // ADMIN
    [InlineData(32L, true, true)] // REQUEST
    [InlineData(262144L, true, false)] // REQUEST_MOVIE
    [InlineData(524288L, false, true)] // REQUEST_TV
    [InlineData(1024L | 64L, false, false)] // REQUEST_4K + VOTE only
    public void MirrorsSeerrsRequestChecks(long bits, bool movies, bool tv)
    {
        Assert.Equal(movies, SeerrPermissions.CanRequestMovies(bits));
        Assert.Equal(tv, SeerrPermissions.CanRequestTv(bits));
    }
}
