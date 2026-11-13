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
    public void UpdatesController_RequiresElevation()
    {
        var attribute = Assert.Single(typeof(UpdatesController).GetCustomAttributes<AuthorizeAttribute>());

        Assert.Equal(Policies.RequiresElevation, attribute.Policy);
    }

    [Fact]
    public void StorageController_RequiresElevation()
    {
        var attribute = Assert.Single(typeof(StorageController).GetCustomAttributes<AuthorizeAttribute>());

        Assert.Equal(Policies.RequiresElevation, attribute.Policy);
    }

    [Fact]
    public void TraktAdminController_RequiresElevation()
    {
        var attribute = Assert.Single(typeof(TraktAdminController).GetCustomAttributes<AuthorizeAttribute>());

        Assert.Equal(Policies.RequiresElevation, attribute.Policy);
    }

    [Fact]
    public void ChartsController_RequiresAuthentication()
    {
        var attribute = Assert.Single(typeof(ChartsController).GetCustomAttributes<AuthorizeAttribute>());

        Assert.Null(attribute.Policy);
    }

    [Fact]
    public void HomeController_RequiresAuthentication()
    {
        var attribute = Assert.Single(typeof(HomeController).GetCustomAttributes<AuthorizeAttribute>());

        Assert.Null(attribute.Policy);
    }

    [Fact]
    public void RequestsController_RequiresAuthentication_ExceptImagesWhichCheckTheirImageToken()
    {
        var attribute = Assert.Single(typeof(RequestsController).GetCustomAttributes<AuthorizeAttribute>());

        Assert.Null(attribute.Policy);

        // GetImage authorizes itself (signed-in user or image token; see RequestsControllerTests.Image_*).
        Assert.All(
            typeof(RequestsController).GetMethods().Where(m => m.Name != nameof(RequestsController.GetImage)),
            m => Assert.Empty(m.GetCustomAttributes<AllowAnonymousAttribute>()));
    }

    [Fact]
    public void PushAdminController_RequiresElevation()
    {
        var attribute = Assert.Single(typeof(PushAdminController).GetCustomAttributes<AuthorizeAttribute>());

        Assert.Equal(Policies.RequiresElevation, attribute.Policy);
    }

    [Fact]
    public void PushController_RequiresAuthentication_ExceptTheWorkerAndSeerrsWebhook()
    {
        var attribute = Assert.Single(typeof(PushController).GetCustomAttributes<AuthorizeAttribute>());

        Assert.Null(attribute.Policy);

        // The worker is a static file browsers fetch without a token; the webhook checks its own secret
        // (PushControllerTests.Webhook_*).
        string[] anonymous = [nameof(PushController.GetWorker), nameof(PushController.SeerrWebhook)];
        Assert.All(
            typeof(PushController).GetMethods().Where(m => m.DeclaringType == typeof(PushController)),
            m => Assert.Equal(anonymous.Contains(m.Name), m.GetCustomAttributes<AllowAnonymousAttribute>().Any()));
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
