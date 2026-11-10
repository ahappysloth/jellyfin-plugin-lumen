using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Injection;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Injection;

public sealed class LumenStartupFilterTests : IDisposable
{
    private const string Hash = "c4b2af8a2931aff1f2de";
    private readonly string _webRoot = Directory.CreateTempSubdirectory("lumen-webstatic").FullName;

    public LumenStartupFilterTests()
    {
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), $"<script defer=\"defer\" src=\"main.jellyfin.bundle.js?{Hash}\"></script>");
        File.WriteAllText(Path.Combine(_webRoot, "main.jellyfin.bundle.js"), "main()");
    }

    public void Dispose() => Directory.Delete(_webRoot, recursive: true);

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task BuildingJellyfinsPipeline_PreparesIndexHtmlsBundles_AndServesThemCachedForGood(bool enabled)
    {
        var config = Substitute.For<ILumenConfigReader>();
        config.Current.Returns(new PluginConfiguration { OptimizeWebClientFiles = enabled });
        var webFiles = new WebStaticFiles(_webRoot, null, NullLogger.Instance);
        var services = new ServiceCollection()
            .AddLogging()
            .AddSingleton(config)
            .AddSingleton(webFiles)
            .AddSingleton(new AssetCatalog(new Dictionary<string, byte[]>()))
            .BuildServiceProvider();
        var filter = new LumenStartupFilter(services.GetRequiredService<AssetCatalog>(), webFiles, config, NullLogger<LumenStartupFilter>.Instance);
        var app = new ApplicationBuilder(services);

        // Jellyfin's static files, reduced to this one file.
        filter.Configure(inner => inner.Run(context => context.Response.SendFileAsync(Path.Combine(_webRoot, "main.jellyfin.bundle.js"))))(app);
        var pipeline = app.Build();
        await webFiles.Warmup!;
        await webFiles.WhenIdleAsync();

        var context = new DefaultHttpContext { RequestServices = services };
        context.Request.Method = "GET";
        context.Request.Path = "/web/main.jellyfin.bundle.js";
        context.Request.QueryString = new QueryString("?" + Hash);
        context.Response.Body = new MemoryStream();
        await pipeline(context);

        // Served from the copies made at startup, without a request having asked for them first.
        Assert.Equal(enabled ? WebStaticFiles.ImmutableCacheControl : string.Empty, context.Response.Headers.CacheControl.ToString());
    }
}
