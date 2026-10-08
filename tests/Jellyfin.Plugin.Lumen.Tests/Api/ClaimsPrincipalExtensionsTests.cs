using System.Security.Claims;
using Jellyfin.Plugin.Lumen.Api;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class ClaimsPrincipalExtensionsTests
{
    [Fact]
    public void ReadsJellyfinUserIdClaim()
    {
        var id = Guid.NewGuid();
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("Jellyfin-UserId", id.ToString("N"))]));

        Assert.Equal(id, principal.GetJellyfinUserId());
        Assert.Null(new ClaimsPrincipal(new ClaimsIdentity()).GetJellyfinUserId());
    }
}
