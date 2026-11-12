using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests;

public class LumenPluginTests
{
    [Fact]
    public void Plugin_HasStableIdentity()
    {
        var paths = Substitute.For<IApplicationPaths>();
        paths.PluginsPath.Returns("/tmp/lumen-tests/plugins");
        paths.PluginConfigurationsPath.Returns("/tmp/lumen-tests/config");

        var plugin = new LumenPlugin(paths, Substitute.For<IXmlSerializer>());

        Assert.Equal("Lumen", plugin.Name);
        Assert.Equal(Guid.Parse("186f9cb8-ba8e-4555-a700-ffa619f48264"), plugin.Id);
        Assert.Same(plugin, LumenPlugin.Instance);
    }

    [Fact]
    public void Plugin_ExposesEmbeddedConfigPage()
    {
        var paths = Substitute.For<IApplicationPaths>();
        paths.PluginsPath.Returns("/tmp/lumen-tests/plugins");
        var plugin = new LumenPlugin(paths, Substitute.For<IXmlSerializer>());

        var page = Assert.Single(plugin.GetPages());

        Assert.Equal("Lumen", page.Name);
        Assert.NotNull(typeof(LumenPlugin).Assembly.GetManifestResourceStream(page.EmbeddedResourcePath));
    }

    [Fact]
    public void ConfigPage_LoadsItsScriptWithLumensVersion_SoNoCacheInFrontKeepsAnOldOne()
    {
        var paths = Substitute.For<IApplicationPaths>();
        paths.PluginsPath.Returns("/tmp/lumen-tests/plugins");
        var page = Assert.Single(new LumenPlugin(paths, Substitute.For<IXmlSerializer>()).GetPages());
        using var stream = typeof(LumenPlugin).Assembly.GetManifestResourceStream(page.EmbeddedResourcePath)!;
        var html = new StreamReader(stream).ReadToEnd();

        // A fixed address (no ?v=) stays in a proxy's cache past an update.
        Assert.DoesNotContain("lumen-admin.js\"", html, StringComparison.Ordinal);
        Assert.Contains("'../Lumen/Assets/lumen-admin.js?v=' +", html, StringComparison.Ordinal);
        Assert.Contains("meta[name=\"lumen-version\"]", html, StringComparison.Ordinal);
    }

    [Fact]
    public void JellyfinsOwnConfigEndpoint_GoesThroughLumensSaveRules()
    {
        // The real chain, as POST /Plugins/{id}/Configuration runs it: plugin, LumenConfigStore, LumenPluginPersistence, plugin.
        using var services = new ServiceCollection()
            .AddSingleton<IPluginConfigPersistence, LumenPluginPersistence>()
            .AddSingleton(Substitute.For<ILibraryCatalog>())
            .AddSingleton(new ConfigValidator([new FakeSectionProvider(SectionTypes.ContinueWatching)]))
            .AddSingleton<ILogger<LumenConfigReader>>(NullLogger<LumenConfigReader>.Instance)
            .AddSingleton<LumenConfigReader>()
            .AddSingleton<ILumenConfigStore, LumenConfigStore>()
            .BuildServiceProvider();
        var plugin = new LumenPlugin(Paths(), Substitute.For<IXmlSerializer>(), services);
        plugin.SaveValidatedConfiguration(new PluginConfiguration
        {
            SchemaVersion = PluginConfiguration.CurrentSchemaVersion,
            ConfigVersion = 4,
            RequestsEnabled = true,
            SeerrUrl = "http://seerr:5055",
            SeerrApiKey = "stored",
        });

        // A backup tool posts the config it read back, which never contains the key.
        var posted = System.Text.Json.JsonSerializer.Deserialize<PluginConfiguration>(
            """{"RequestsEnabled":true,"SeerrUrl":"http://seerr:5055/","AccentColor":"#123456","Sections":[]}""")!;
        plugin.UpdateConfiguration(posted);

        Assert.Equal("stored", plugin.Configuration.SeerrApiKey);
        Assert.Equal("#123456", plugin.Configuration.AccentColor);
        Assert.Equal(5, plugin.Configuration.ConfigVersion);

        var error = Assert.Throws<ArgumentException>(() => plugin.UpdateConfiguration(new PluginConfiguration { AccentColor = "red" }));
        Assert.Contains("Accent color", error.Message, StringComparison.Ordinal);
        Assert.Equal("#123456", plugin.Configuration.AccentColor);
        Assert.Equal(5, plugin.Configuration.ConfigVersion);
    }

    [Fact]
    public void JellyfinsOwnConfigEndpoint_RejectsWhatTheStoreRejects()
    {
        var store = Substitute.For<ILumenConfigStore>();
        store.Save(Arg.Any<PluginConfiguration>()).Returns(new ConfigSaveResult(false, ["Requests need Seerr's API key."]));
        using var services = new ServiceCollection().AddSingleton(store).BuildServiceProvider();
        var plugin = new LumenPlugin(Paths(), Substitute.For<IXmlSerializer>(), services);
        var posted = new PluginConfiguration { RequestsEnabled = true, SeerrUrl = "http://elsewhere:5055" };

        Assert.Throws<ArgumentException>(() => plugin.UpdateConfiguration(posted));

        store.Received(1).Save(posted);
    }

    private static IApplicationPaths Paths()
    {
        var paths = Substitute.For<IApplicationPaths>();
        paths.PluginsPath.Returns("/tmp/lumen-tests/plugins");
        paths.PluginConfigurationsPath.Returns(Path.Combine(Path.GetTempPath(), "lumen-tests", "config"));
        return paths;
    }
}
