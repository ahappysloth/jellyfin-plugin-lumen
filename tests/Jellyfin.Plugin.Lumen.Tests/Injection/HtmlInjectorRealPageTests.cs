using Jellyfin.Plugin.Lumen.Injection;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Injection;

/// <summary>
/// HtmlInjector against real jellyfin-web index.html files rather than made-up markup, so a change in how jellyfin-web
/// writes its head (attribute order, quoting, minification) shows up here. To add a version:
/// <c>docker run --rm --entrypoint cat jellyfin/jellyfin:X.Y /jellyfin/jellyfin-web/index.html &gt; Injection/Fixtures/jellyfin-web-X.Y.index.html</c>.
/// </summary>
public class HtmlInjectorRealPageTests
{
    private static string FixtureDirectory => Path.Combine(AppContext.BaseDirectory, "Injection", "Fixtures");

    public static TheoryData<string> Pages()
    {
        var data = new TheoryData<string>();
        foreach (var path in Directory.GetFiles(FixtureDirectory, "jellyfin-web-*.index.html").Order(StringComparer.Ordinal))
        {
            data.Add(Path.GetFileName(path));
        }

        return data;
    }

    [Fact]
    public void HasFixtures()
    {
        Assert.NotEmpty(Pages());
    }

    [Theory]
    [MemberData(nameof(Pages))]
    public void InjectsIntoTheHead_AfterJellyfinWebsScripts(string fixture)
    {
        var page = Load(fixture);

        var result = HtmlInjector.Inject(page, "h", "guard()", styleStockPages: true);

        var marker = result.IndexOf(HtmlInjector.Marker, StringComparison.Ordinal);
        Assert.True(marker > 0);
        Assert.True(marker > result.LastIndexOf("main.jellyfin.bundle.js", StringComparison.Ordinal), "after the stock bundles");
        Assert.True(marker < result.IndexOf("</head>", StringComparison.Ordinal), "inside <head>");
        Assert.True(result.IndexOf("<body", StringComparison.Ordinal) > marker, "before <body>");
        Assert.Contains("<script>document.documentElement.setAttribute('data-lmn-skin','');guard()</script>", result, StringComparison.Ordinal);
        Assert.Equal(result, HtmlInjector.Inject(result, "h", "guard()", styleStockPages: true));
    }

    [Theory]
    [MemberData(nameof(Pages))]
    public void HasTheTagsTheAppIdentitySwapExpects(string fixture)
    {
        var page = Load(fixture);

        Assert.Contains("<link rel=\"manifest\"", page, StringComparison.Ordinal);
        Assert.Contains("<link rel=\"apple-touch-icon\"", page, StringComparison.Ordinal);
        Assert.Contains("<meta id=\"themeColor\"", page, StringComparison.Ordinal);
        Assert.Contains("<div id=\"reactRoot\"", page, StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(Pages))]
    public void InstallsAsLumen_OnTheRealPage(string fixture)
    {
        var page = Load(fixture);

        var result = HtmlInjector.Inject(page, "h", installAsLumen: true);

        Assert.Contains("<link rel=\"manifest\" href=\"../Lumen/Manifest\">", result, StringComparison.Ordinal);
        Assert.DoesNotContain("href=\"manifest.json\"", result, StringComparison.Ordinal);
        Assert.DoesNotContain("href=\"touchicon.", result, StringComparison.Ordinal);
        Assert.Contains("lumen-icon-180.png?v=h", result, StringComparison.Ordinal);
        Assert.DoesNotContain("content=\"#202020\"", result, StringComparison.Ordinal);
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(result, "<link rel=\"manifest\""));
    }

    private static string Load(string fixture) => File.ReadAllText(Path.Combine(FixtureDirectory, fixture));
}
