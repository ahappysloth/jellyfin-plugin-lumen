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
    public void RejectsTooManySections()
    {
        var sections = Enumerable.Range(0, 31).Select(_ => TestData.Section("Plain")).ToArray();

        Assert.Contains(CreateValidator().Validate(Valid(sections)), e => e.Contains("at most 30", StringComparison.Ordinal));
    }

    private static PluginConfiguration Valid(params SectionDefinition[] sections) =>
        new() { SchemaVersion = 1, Sections = sections.ToList() };

    private ConfigValidator CreateValidator() => new([_counted, new FakeSectionProvider("Plain")]);
}
