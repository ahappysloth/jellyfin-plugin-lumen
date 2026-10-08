using Jellyfin.Plugin.Lumen.Configuration;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Configuration;

public class ConfigMigratorTests
{
    private static readonly LibraryInfo Movies = new(Guid.NewGuid(), "Movies", "Movies");
    private static readonly LibraryInfo Shows = new(Guid.NewGuid(), "Shows", "TvShows");
    private static readonly LibraryInfo Music = new(Guid.NewGuid(), "Music", "Music");

    [Fact]
    public void FreshConfig_IsSeededWithDefaultSections()
    {
        var config = new PluginConfiguration();

        var changed = ConfigMigrator.Migrate(config, [Movies, Shows, Music]);

        Assert.True(changed);
        Assert.Equal(PluginConfiguration.CurrentSchemaVersion, config.SchemaVersion);
        Assert.Equal(
            [SectionTypes.ContinueWatching, SectionTypes.NextUp, SectionTypes.BecauseYouWatched, SectionTypes.NewForYou,
             SectionTypes.RecentlyAdded, SectionTypes.RecentlyAdded, SectionTypes.Genre],
            config.Sections.Select(s => s.Type));
        var recent = config.Sections.Where(s => s.Type == SectionTypes.RecentlyAdded).ToList();
        Assert.Equal(Movies.Id, recent[0].GetGuidParam("libraryId"));
        Assert.Equal(Shows.Id, recent[1].GetGuidParam("libraryId"));
        Assert.All(config.Sections, s => Assert.NotEqual(Guid.Empty, s.Id));
        Assert.Equal(config.Sections.Count, config.Sections.Select(s => s.Id).Distinct().Count());
    }

    [Fact]
    public void NoVideoLibraries_AddsSingleAllLibrariesRecentlyAdded()
    {
        var config = new PluginConfiguration();

        ConfigMigrator.Migrate(config, [Music]);

        var recent = Assert.Single(config.Sections, s => s.Type == SectionTypes.RecentlyAdded);
        Assert.Null(recent.GetParam("libraryId"));
    }

    [Fact]
    public void CurrentConfig_IsUntouched()
    {
        var config = new PluginConfiguration { SchemaVersion = PluginConfiguration.CurrentSchemaVersion };

        var changed = ConfigMigrator.Migrate(config, [Movies]);

        Assert.False(changed);
        Assert.Empty(config.Sections);
    }

    [Fact]
    public void LegacyConfigWithSections_KeepsThem()
    {
        var existing = new SectionDefinition { Id = Guid.NewGuid(), Type = SectionTypes.NextUp };
        var config = new PluginConfiguration { SchemaVersion = 0, Sections = [existing] };

        ConfigMigrator.Migrate(config, [Movies]);

        Assert.Same(existing, Assert.Single(config.Sections));
        Assert.Equal(PluginConfiguration.CurrentSchemaVersion, config.SchemaVersion);
    }

    [Fact]
    public void Defaults_MatchSpec()
    {
        var config = new PluginConfiguration();

        Assert.True(config.Enabled);
        Assert.True(config.HomeTakeover);
        Assert.True(config.DetailsTakeover);
        Assert.Equal("#f5a524", config.AccentColor);
        Assert.Equal(HeroSource.RecentlyAdded, config.HeroSource);
        Assert.Equal(5, config.HeroCount);
        Assert.Equal(8, config.HeroIntervalSeconds);
        Assert.True(config.TrailerPreview);
        Assert.Equal(4, config.TrailerDelaySeconds);
    }
}
