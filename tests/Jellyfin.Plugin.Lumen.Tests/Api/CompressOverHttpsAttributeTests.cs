using System.Net.Http.Headers;
using System.Reflection;
using Jellyfin.Plugin.Lumen.Api;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class CompressOverHttpsAttributeTests
{
    /// <summary>Pins which actions compress over HTTPS: each must hold no secret (see the attribute's remarks).</summary>
    [Fact]
    public void AppliesOnlyToTheHomeAndCatalogReads()
    {
        var compressed = typeof(HomeController).Assembly.GetTypes()
            .Where(t => t.IsAssignableTo(typeof(ControllerBase)))
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            .Where(m => m.GetCustomAttribute<CompressOverHttpsAttribute>() is not null)
            .Select(m => $"{m.DeclaringType!.Name}.{m.Name}")
            .Order(StringComparer.Ordinal);

        Assert.Equal(
            [
                $"{nameof(HomeController)}.{nameof(HomeController.GetHome)}",
                $"{nameof(RequestsController)}.{nameof(RequestsController.GetTitle)}",
                $"{nameof(RequestsController)}.{nameof(RequestsController.Search)}",
            ],
            compressed);
    }

    [Fact]
    public void SetsTheRequestsHttpsCompressionMode()
    {
        var feature = new CompressionFeature();
        var http = new DefaultHttpContext();
        http.Features.Set<IHttpsCompressionFeature>(feature);

        new CompressOverHttpsAttribute().OnActionExecuting(Executing(http));

        Assert.Equal(HttpsCompressionMode.Compress, feature.Mode);
    }

    [Fact]
    public void WithoutCompressionMiddleware_DoesNothing()
    {
        var http = new DefaultHttpContext();

        new CompressOverHttpsAttribute().OnActionExecuting(Executing(http));

        Assert.Null(http.Features.Get<IHttpsCompressionFeature>());
    }

    /// <summary>ASP.NET Core's own middleware, in Jellyfin's order (compression, then routing and MVC), with its defaults.</summary>
    [Theory]
    [InlineData("https://localhost", "/compression-probe/opted-in", "br")]
    [InlineData("https://localhost", "/compression-probe/default", null)]
    [InlineData("http://localhost", "/compression-probe/default", "br")]
    public async Task OverHttps_CompressesOnlyTheActionsThatOptIn(string baseAddress, string path, string? encoding)
    {
        using var host = await new HostBuilder()
            .ConfigureWebHost(web => web
                .UseTestServer()
                .ConfigureServices(services =>
                {
                    services.AddResponseCompression();
                    services.AddControllers().ConfigureApplicationPartManager(parts =>
                    {
                        parts.ApplicationParts.Clear();
                        parts.ApplicationParts.Add(new AssemblyPart(typeof(CompressionProbeController).Assembly));
                    });
                })
                .Configure(app =>
                {
                    app.UseResponseCompression();
                    app.UseRouting();
                    app.UseEndpoints(endpoints => endpoints.MapControllers());
                }))
            .StartAsync();
        using var client = host.GetTestClient();
        client.BaseAddress = new Uri(baseAddress);
        client.DefaultRequestHeaders.AcceptEncoding.Add(new StringWithQualityHeaderValue("br"));

        using var response = await client.GetAsync(path);

        response.EnsureSuccessStatusCode();
        Assert.Equal(encoding is null ? [] : [encoding], response.Content.Headers.ContentEncoding);
    }

    private static ActionExecutingContext Executing(HttpContext http) => new(
        new ActionContext(http, new RouteData(), new ActionDescriptor()),
        [],
        new Dictionary<string, object?>(),
        controller: new object());

    private sealed class CompressionFeature : IHttpsCompressionFeature
    {
        public HttpsCompressionMode Mode { get; set; }
    }
}

/// <summary>Two identical JSON actions, one opted in (used by <see cref="CompressOverHttpsAttributeTests"/>).</summary>
[ApiController]
[Route("compression-probe")]
public sealed class CompressionProbeController : ControllerBase
{
    private static readonly string[] Payload = Enumerable.Range(0, 200).Select(i => $"item {i}").ToArray();

    [HttpGet("opted-in")]
    [CompressOverHttps]
    public IActionResult OptedIn() => Ok(Payload);

    [HttpGet("default")]
    public IActionResult Default() => Ok(Payload);
}
