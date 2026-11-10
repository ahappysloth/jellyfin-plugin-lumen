using Jellyfin.Plugin.Lumen.Injection;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Injection;

public class HtmlInjectorTests
{
    private const string Page = "<!DOCTYPE html><html><head><title>Jellyfin</title><script defer src=\"main.js\"></script></head><body></body></html>";

    [Fact]
    public void InsertsTagsBeforeHeadClose_AfterStockScripts()
    {
        var result = HtmlInjector.Inject(Page, "abc123");

        var marker = result.IndexOf(HtmlInjector.Marker, StringComparison.Ordinal);
        Assert.True(marker > result.IndexOf("main.js", StringComparison.Ordinal));
        Assert.True(marker < result.IndexOf("</head>", StringComparison.Ordinal));
        Assert.Contains("<link rel=\"stylesheet\" href=\"../Lumen/Assets/lumen.css?v=abc123\">", result, StringComparison.Ordinal);
        Assert.Contains("<script type=\"module\" src=\"../Lumen/Assets/lumen.js?v=abc123\"></script>", result, StringComparison.Ordinal);
    }

    [Fact]
    public void InlinesTheGuard_BeforeStylesheet_EscapingClosingTags()
    {
        var result = HtmlInjector.Inject(Page, "h", "var s='</script>';guard()");

        var guard = result.IndexOf("guard()", StringComparison.Ordinal);
        Assert.True(guard > result.IndexOf(HtmlInjector.Marker, StringComparison.Ordinal));
        Assert.True(guard < result.IndexOf("lumen.css", StringComparison.Ordinal));
        Assert.Contains("<script>var s='<\\/script>';guard()</script>", result, StringComparison.Ordinal);
    }

    [Fact]
    public void MarksThePageForStyling_BeforeTheGuardRuns()
    {
        var result = HtmlInjector.Inject(Page, "h", "guard()", styleStockPages: true);

        Assert.Contains("<script>document.documentElement.setAttribute('data-lmn-skin','');guard()</script>", result, StringComparison.Ordinal);
        Assert.DoesNotContain("data-lmn-skin", HtmlInjector.Inject(Page, "h", "guard()"), StringComparison.Ordinal);
    }

    [Fact]
    public void LinksTheAdminStylesheet_AfterLumens_OnlyWhenStylingStockPages()
    {
        const string link = "<link rel=\"stylesheet\" href=\"../Lumen/Assets/lumen-dashboard.css?v=h\">";
        var result = HtmlInjector.Inject(Page, "h", "guard()", styleStockPages: true);

        Assert.Contains(link, result, StringComparison.Ordinal);
        Assert.True(result.IndexOf(link, StringComparison.Ordinal) > result.IndexOf("lumen.css", StringComparison.Ordinal));
        Assert.DoesNotContain("lumen-dashboard.css", HtmlInjector.Inject(Page, "h", "guard()"), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("#2266ff", true)]
    [InlineData("red;}body{display:none", false)]
    [InlineData("</style><script>x()</script>", false)]
    [InlineData(null, false)]
    public void GivesTheAdminPagesTheAccent_OnlyAValidHexColour(string? accent, bool expected)
    {
        var result = HtmlInjector.Inject(Page, "h", "guard()", styleStockPages: true, accentColor: accent);

        Assert.Equal(expected, result.Contains("<style>html.lmn-skin-dashboard{--lmn-accent:#2266ff}</style>", StringComparison.Ordinal));
        Assert.DoesNotContain("<style>", HtmlInjector.Inject(Page, "h", "guard()", accentColor: "#2266ff"), StringComparison.Ordinal);
        Assert.DoesNotContain("x()", result, StringComparison.Ordinal);
    }

    [Fact]
    public void InstallsAsLumen_SwappingManifestTouchIconAndThemeColor()
    {
        const string page = "<html><head><meta id=\"themeColor\" name=\"theme-color\" content=\"#202020\">"
            + "<link rel=\"manifest\" href=\"manifest.json\"><link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"touchicon.png\">"
            + "</head><body></body></html>";

        var result = HtmlInjector.Inject(page, "h", installAsLumen: true);

        Assert.Contains("<link rel=\"manifest\" href=\"../Lumen/Manifest\">", result, StringComparison.Ordinal);
        Assert.DoesNotContain("touchicon.png", result, StringComparison.Ordinal);
        Assert.Contains("href=\"../Lumen/Assets/lumen-icon-180.png?v=h\"", result, StringComparison.Ordinal);
        Assert.Contains("content=\"#0f0f0f\"", result, StringComparison.Ordinal);
        Assert.Contains("manifest.json", HtmlInjector.Inject(page, "h"), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("<link href=\"manifest.json\" rel=\"manifest\"><link sizes=\"180x180\" rel=\"apple-touch-icon\" href=\"touchicon.png\"><meta content=\"#202020\" id=\"themeColor\">")]
    [InlineData("<LINK crossorigin rel='manifest' href='manifest.json'/><link\nrel=apple-touch-icon href=touchicon.png><meta name=\"theme-color\" content=\"#202020\">")]
    [InlineData("<meta name=\"theme-color\" content=\"#202020\"><meta id=\"themeColor\" content=\"#202020\"><link rel=\"manifest\" href=\"manifest.json\"><link rel=\"apple-touch-icon\" href=\"touchicon.png\">")]
    public void InstallsAsLumen_WhateverTheAttributeOrderAndQuoting(string tags)
    {
        var notFound = new List<string>();

        var result = HtmlInjector.Inject("<html><head>" + tags + "</head><body></body></html>", "h", installAsLumen: true, notFound: notFound);

        Assert.Empty(notFound);
        Assert.DoesNotContain("manifest.json", result, StringComparison.Ordinal);
        Assert.DoesNotContain("touchicon.png", result, StringComparison.Ordinal);
        Assert.DoesNotContain("#202020", result, StringComparison.Ordinal);
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(result, "theme-color"));
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(result, "rel=\"manifest\""));
    }

    [Fact]
    public void ReportsTheTagsItCouldNotFind_AndLeavesLookalikesAlone()
    {
        var notFound = new List<string>();
        const string page = "<html><head><link data-rel=\"manifest\" href=\"a.json\"><link rel=\"manifest-x\" href=\"b.json\"></head></html>";

        var result = HtmlInjector.Inject(page, "h", installAsLumen: true, notFound: notFound);

        Assert.Equal(["manifest link", "apple-touch-icon link", "theme-color meta"], notFound);
        Assert.Contains("<link data-rel=\"manifest\" href=\"a.json\">", result, StringComparison.Ordinal);
        Assert.Contains("<link rel=\"manifest-x\" href=\"b.json\">", result, StringComparison.Ordinal);

        var notInstalling = new List<string>();
        HtmlInjector.Inject(page, "h", notFound: notInstalling);
        Assert.Empty(notInstalling);
    }

    [Fact]
    public void OmitsTheGuard_WhenNoneIsGiven()
    {
        var result = HtmlInjector.Inject(Page, "h");

        Assert.DoesNotContain("<script>", result, StringComparison.Ordinal);
    }

    [Fact]
    public void UsesRelativeUrls_SoBaseUrlInstallsWork()
    {
        var result = HtmlInjector.Inject(Page, "h");

        Assert.DoesNotContain("href=\"/Lumen", result, StringComparison.Ordinal);
        Assert.DoesNotContain("src=\"/Lumen", result, StringComparison.Ordinal);
    }

    [Fact]
    public void IsIdempotent()
    {
        var once = HtmlInjector.Inject(Page, "h");

        Assert.Equal(once, HtmlInjector.Inject(once, "h"));
    }

    [Fact]
    public void LeavesHtmlWithoutHeadClose_Unchanged()
    {
        const string fragment = "<div>no head</div>";

        Assert.Same(fragment, HtmlInjector.Inject(fragment, "h"));
    }

    [Fact]
    public void MatchesHeadCloseCaseInsensitively_AndKeepsOtherInjectors()
    {
        const string page = "<html><HEAD><!-- other plugin --></HEAD><body></body></html>";

        var result = HtmlInjector.Inject(page, "h");

        Assert.Contains("<!-- other plugin -->" + HtmlInjector.Marker, result, StringComparison.Ordinal);
    }

    [Fact]
    public void EscapesHash()
    {
        var result = HtmlInjector.Inject(Page, "a\"b");

        Assert.Contains("v=a%22b", result, StringComparison.Ordinal);
    }
}
