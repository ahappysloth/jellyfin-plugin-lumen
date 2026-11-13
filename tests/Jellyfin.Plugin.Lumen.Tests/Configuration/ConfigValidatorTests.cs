using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Configuration;

public class ConfigValidatorTests
{
    private readonly FakeSectionProvider _counted = new(
        "Counted",
        new SectionParameter("count", "Count", SectionParameterKind.Integer, Required: true, Min: 1, Max: 5),
        new SectionParameter("libraryId", "Library", SectionParameterKind.Library));

    [Fact]
    public void Requests_NeedAnAddressAndKey_OnlyWhenEnabled()
    {
        var validator = new ConfigValidator([]);

        Assert.DoesNotContain(validator.Validate(new PluginConfiguration { RequestsEnabled = false }), e => e.Contains("Seerr", StringComparison.Ordinal));
        var errors = validator.Validate(new PluginConfiguration { RequestsEnabled = true, SeerrUrl = "seerr:5055" });
        Assert.Contains(errors, e => e.Contains("Seerr's address", StringComparison.Ordinal));
        Assert.Contains(errors, e => e.Contains("Seerr's API key", StringComparison.Ordinal));
        Assert.DoesNotContain(
            validator.Validate(new PluginConfiguration { RequestsEnabled = true, SeerrUrl = "https://seerr.example/", SeerrApiKey = "k" }),
            e => e.Contains("Seerr", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", true)]
    [InlineData("short", false)]
    [InlineData("has a space in it", false)]
    [InlineData("line\r\nbreak-header", false)]
    public void TraktKey_MustBeHeaderSafe(string? key, bool valid)
    {
        var errors = new ConfigValidator([]).Validate(new PluginConfiguration { TraktClientId = key });

        Assert.Equal(valid, !errors.Any(e => e.Contains("Trakt", StringComparison.Ordinal)));
    }

    [Theory]
    [InlineData("http://seerr:5055", true)]
    [InlineData("https://seerr.example/base/", true)]
    [InlineData("ftp://seerr", false)]
    [InlineData("http://user:pass@seerr", false)]
    [InlineData("http://seerr?x=1", false)]
    [InlineData("seerr:5055", false)]
    [InlineData(null, false)]
    public void IsHttpUrl(string? value, bool expected) => Assert.Equal(expected, ConfigValidator.IsHttpUrl(value));

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("https://jellyfin.example.com", true)]
    [InlineData("http://192.168.1.20:8096", true)]
    [InlineData("http://tv-box.tail1234.ts.net:8096/jellyfin/", true)]
    [InlineData("https://jellyfin.example.com/web/", true)]
    [InlineData("https://jellyfin.example.com/web/index.html", true)]
    [InlineData("jellyfin.example.com", false)]
    [InlineData("ftp://jellyfin.example.com", false)]
    [InlineData("https://user:pass@jellyfin.example.com", false)]
    [InlineData("https://jellyfin.example.com/?", false)]
    [InlineData("https://jellyfin.example.com/#", false)]
    [InlineData("https://jellyfin.example.com/\"><script>", false)]
    [InlineData("https://a-very-long-host-name-for-a-jellyfin-server.example.com/with/a/long/base", false)]
    public void QuickConnectAddress_IsAnHttpAddressThatFitsTheQrCode(string? address, bool valid)
    {
        Assert.Equal(valid, ConfigValidator.IsQuickConnectAddress(address));
        var errors = new ConfigValidator([]).Validate(new PluginConfiguration { QuickConnectAddress = address });
        Assert.Equal(valid, !errors.Any(e => e.Contains("QR codes", StringComparison.Ordinal)));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("   ", null)]
    [InlineData("https://jellyfin.example.com", "https://jellyfin.example.com")]
    [InlineData(" https://jellyfin.example.com/ ", "https://jellyfin.example.com")]
    [InlineData("https://jellyfin.example.com/web", "https://jellyfin.example.com")]
    [InlineData("https://jellyfin.example.com/web/", "https://jellyfin.example.com")]
    [InlineData("https://jellyfin.example.com/WEB/index.html", "https://jellyfin.example.com")]
    [InlineData("http://192.168.1.20:8096/jf/web/", "http://192.168.1.20:8096/jf")]
    [InlineData("http://192.168.1.20:8096/jf//", "http://192.168.1.20:8096/jf")]
    [InlineData("https://example.com/webby/", "https://example.com/webby")]
    public void NormalizeQuickConnectAddress_DropsJellyfinWebsOwnPathAndTrailingSlashes(string? address, string? expected) =>
        Assert.Equal(expected, ConfigValidator.NormalizeQuickConnectAddress(address));

    [Fact]
    public void QuickConnectAddress_IsMeasuredWithoutTheWebPathItLoses()
    {
        var fits = "https://" + new string('a', 55) + ".example.com";
        Assert.True(ConfigValidator.IsQuickConnectAddress(fits + "/web/"));
        Assert.False(ConfigValidator.IsQuickConnectAddress("https://" + new string('a', 56) + ".example.com/web/"));
    }

    [Fact]
    public void ValidConfig_HasNoErrors()
    {
        var errors = CreateValidator().Validate(Valid(TestData.Section("Counted", ("count", "3")), TestData.Section("Plain")));

        Assert.Empty(errors);
    }

    [Theory]
    [InlineData("f5a524")]
    [InlineData("#f5a52")]
    [InlineData("red")]
    [InlineData("#f5a524;}body{")]
    public void RejectsBadAccentColor(string color)
    {
        var config = Valid();
        config.AccentColor = color;

        Assert.Contains(CreateValidator().Validate(config), e => e.Contains("Accent color", StringComparison.Ordinal));
    }

    [Fact]
    public void RejectsOutOfRangeHeroSettings()
    {
        var config = Valid();
        config.HeroCount = 0;
        config.HeroIntervalSeconds = 2;
        config.TrailerDelaySeconds = 31;

        var errors = CreateValidator().Validate(config);

        Assert.Equal(3, errors.Count);
    }

    [Fact]
    public void RejectsAnUnknownHeroSource()
    {
        var config = Valid();
        config.HeroSource = (HeroSource)42;

        Assert.Contains(CreateValidator().Validate(config), e => e.Contains("Hero source", StringComparison.Ordinal));
    }

    [Fact]
    public void CollectionHeroRequiresCollection()
    {
        var config = Valid();
        config.HeroSource = HeroSource.Collection;

        Assert.Contains(CreateValidator().Validate(config), e => e.Contains("collection", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void RejectsUnknownType_DuplicateIds_AndEmptyIds()
    {
        var a = TestData.Section("Plain");
        var b = TestData.Section("Plain");
        b.Id = a.Id;
        var c = TestData.Section("Nope");
        var d = TestData.Section("Plain");
        d.Id = Guid.Empty;

        var errors = CreateValidator().Validate(Valid(a, b, c, d));

        Assert.Contains(errors, e => e.Contains("duplicate", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(errors, e => e.Contains("unknown section type 'Nope'", StringComparison.Ordinal));
        Assert.Contains(errors, e => e.Contains("missing an id", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData(null, "is required")]
    [InlineData("abc", "must be a whole number")]
    [InlineData("9", "between 1 and 5")]
    public void ChecksIntegerParams(string? value, string expected)
    {
        var section = value is null ? TestData.Section("Counted") : TestData.Section("Counted", ("count", value));

        Assert.Contains(CreateValidator().Validate(Valid(section)), e => e.Contains(expected, StringComparison.Ordinal));
    }

    [Fact]
    public void ChecksGuidParams_AndUnknownParams()
    {
        var section = TestData.Section("Counted", ("count", "2"), ("libraryId", "not-a-guid"), ("extra", "1"));

        var errors = CreateValidator().Validate(Valid(section));

        Assert.Contains(errors, e => e.Contains("Library must be a valid id", StringComparison.Ordinal));
        Assert.Contains(errors, e => e.Contains("unknown parameter 'extra'", StringComparison.Ordinal));
    }

    [Fact]
    public void IncludesProviderSpecificErrors()
    {
        _counted.ValidateRule = _ => ["custom problem"];

        var errors = CreateValidator().Validate(Valid(TestData.Section("Counted", ("count", "2"))));

        Assert.Contains(errors, e => e.EndsWith("custom problem", StringComparison.Ordinal));
    }

    [Fact]
    public void ASectionsErrors_NameItAsTheEditorDoes_WithItsRow()
    {
        _counted.ValidateRule = _ => ["custom problem"];
        var renamed = TestData.Section("Counted", ("count", "2"));
        renamed.Title = " Weekend picks ";
        var unknown = TestData.Section("Nope");
        var untyped = TestData.Section("Plain");
        untyped.Type = " ";

        var errors = CreateValidator().Validate(Valid(TestData.Section("Plain"), TestData.Section("Counted", ("count", "2")), renamed, unknown, untyped));

        // Its type's name as the editor shows it (not the internal "Counted"), or its own title; the row counts from 1.
        Assert.Equal(
            [
                "Counted (fake) (row 2): custom problem",
                "Weekend picks (row 3): custom problem",
                "Nope (row 4): unknown section type 'Nope'.",
                "Section (row 5): section type is required.",
            ],
            errors);
    }

    [Fact]
    public void RejectsTooManySections()
    {
        var sections = Enumerable.Range(0, 31).Select(_ => TestData.Section("Plain")).ToArray();

        Assert.Contains(CreateValidator().Validate(Valid(sections)), e => e.Contains("at most 30", StringComparison.Ordinal));
    }

    [Fact]
    public void NullSections_IsAnError_NotAnException()
    {
        var config = Valid();
        config.Sections = null!;

        Assert.Contains("Sections are required.", CreateValidator().Validate(config));
    }

    [Fact]
    public void NullParams_AreTreatedAsEmpty()
    {
        var section = TestData.Section("Plain");
        section.Params = null!;

        Assert.Empty(CreateValidator().Validate(Valid(section)));
        Assert.Empty(section.Params);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void MissingSectionType_IsAnError(string? type)
    {
        var section = TestData.Section("Plain");
        section.Type = type!;

        Assert.Contains(CreateValidator().Validate(Valid(section)), e => e.Contains("type is required", StringComparison.Ordinal));
    }

    [Fact]
    public void NullSectionEntry_IsAnError()
    {
        var config = Valid();
        config.Sections.Add(null!);

        Assert.Contains(CreateValidator().Validate(config), e => e.Contains("is missing", StringComparison.Ordinal));
    }

    private static PluginConfiguration Valid(params SectionDefinition[] sections) =>
        new() { SchemaVersion = 1, Sections = sections.ToList() };

    private ConfigValidator CreateValidator() => new([_counted, new FakeSectionProvider("Plain")]);
}
