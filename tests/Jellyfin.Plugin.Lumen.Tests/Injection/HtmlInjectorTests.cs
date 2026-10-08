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
        Assert.Contains("<script defer src=\"../Lumen/Assets/lumen.js?v=abc123\"></script>", result, StringComparison.Ordinal);
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
