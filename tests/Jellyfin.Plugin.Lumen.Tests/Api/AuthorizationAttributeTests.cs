using System.Reflection;
using Jellyfin.Plugin.Lumen.Api;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

/// <summary>Pins the authorization surface, since a dropped attribute silently exposes an endpoint.</summary>
public class AuthorizationAttributeTests
{
    [Fact]
    public void AdminController_RequiresElevation()
    {
        var attribute = Assert.Single(typeof(AdminController).GetCustomAttributes<AuthorizeAttribute>());

        Assert.Equal(Policies.RequiresElevation, attribute.Policy);
    }

    [Fact]
    public void HomeController_RequiresAuthentication()
    {
        var attribute = Assert.Single(typeof(HomeController).GetCustomAttributes<AuthorizeAttribute>());

        Assert.Null(attribute.Policy);
    }

    [Theory]
    [InlineData(nameof(LumenController.GetClientConfig))]
    [InlineData(nameof(LumenController.PostDiagnostics))]
    public void LumenController_AuthenticatedEndpoints_AreAuthorized(string method)
    {
        var info = typeof(LumenController).GetMethod(method)!;

        Assert.NotEmpty(info.GetCustomAttributes<AuthorizeAttribute>());
        Assert.Empty(info.GetCustomAttributes<AllowAnonymousAttribute>());
    }

    [Fact]
    public void LumenController_GetAsset_IsAnonymous()
    {
        var info = typeof(LumenController).GetMethod(nameof(LumenController.GetAsset))!;

        Assert.NotEmpty(info.GetCustomAttributes<AllowAnonymousAttribute>());
    }
}
