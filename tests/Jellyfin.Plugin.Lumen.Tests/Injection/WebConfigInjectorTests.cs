using System.Text.Json.Nodes;
using Jellyfin.Plugin.Lumen.Injection;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Injection;

public class WebConfigInjectorTests
{
    /// <summary>jellyfin-web 12.4's src/config.json, which its build copies to /web/config.json unchanged.</summary>
    private static string RealConfig => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Injection", "Fixtures", "jellyfin-web-12.4.config.json"));

    [Fact]
    public void AppendsThePlugin_KeepingEverythingElse()
    {
        var original = RealConfig;

        var result = WebConfigInjector.AddPlugin(original);

        var before = JsonNode.Parse(original)!.AsObject();
        var after = JsonNode.Parse(result!)!.AsObject();
        var plugins = after["plugins"]!.AsArray().Select(p => p!.GetValue<string>()).ToList();
        Assert.Equal(before["plugins"]!.AsArray().Select(p => p!.GetValue<string>()).Append(WebConfigInjector.PluginName), plugins);
        after.Remove("plugins");
        before.Remove("plugins");
        Assert.True(JsonNode.DeepEquals(before, after));
        Assert.Equal(before.Select(p => p.Key), after.Select(p => p.Key));
    }

    [Fact]
    public void IsIdempotent()
    {
        var once = WebConfigInjector.AddPlugin(RealConfig)!;

        Assert.Same(once, WebConfigInjector.AddPlugin(once));
    }

    [Theory]
    [InlineData("{\"themes\":[]}")]
    [InlineData("{\"plugins\":null}")]
    [InlineData("{\"plugins\":\"syncPlay/plugin\"}")]
    [InlineData("[\"syncPlay/plugin\"]")]
    [InlineData("{\"plugins\":[]")]
    [InlineData("{\"plugins\":[], /* comment */ \"servers\":[]}")]
    [InlineData("{\"plugins\":[],\"plugins\":[]}")]
    [InlineData("")]
    public void LeavesFilesWithoutAPluginList_OrInvalidJson_Alone(string json)
    {
        // With no plugins array jellyfin-web uses its built-in list; one holding only Lumen's would replace it.
        Assert.Null(WebConfigInjector.AddPlugin(json));
    }

    [Fact]
    public void KeepsNonAsciiText()
    {
        var result = WebConfigInjector.AddPlugin("{\"menuLinks\":[{\"name\":\"Médiathèque & <docs>\"}],\"plugins\":[]}")!;

        Assert.Contains("Médiathèque", result, StringComparison.Ordinal);
        Assert.Equal("Médiathèque & <docs>", JsonNode.Parse(result)!["menuLinks"]![0]!["name"]!.GetValue<string>());
    }
}
