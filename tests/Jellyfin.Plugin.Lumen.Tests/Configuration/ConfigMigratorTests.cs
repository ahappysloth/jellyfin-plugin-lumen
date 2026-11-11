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
            [SectionTypes.MyRequests, SectionTypes.ContinueWatching, SectionTypes.NextUp, SectionTypes.BecauseYouWatched, SectionTypes.NewForYou,
             SectionTypes.RecentlyAdded, SectionTypes.RecentlyAdded, SectionTypes.Genre, SectionTypes.Genres],
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
        Assert.Equal("#e30b17", config.AccentColor);
        Assert.Equal(HeroSource.RecentlyAdded, config.HeroSource);
        Assert.Equal(5, config.HeroCount);
        Assert.Equal(8, config.HeroIntervalSeconds);
        Assert.True(config.TrailerPreview);
        Assert.Equal(4, config.TrailerDelaySeconds);
        Assert.False(config.HeroWaitForTrailer);
    }

    [Fact]
    public void ConfigSavedBeforeHeroWaitForTrailer_ReadsItAsOff()
    {
        // Jellyfin stores the configuration as XML; one written by an older Lumen has no element for the setting.
        var xml = new System.Xml.Serialization.XmlSerializer(typeof(PluginConfiguration));
        using var text = new StringReader("<PluginConfiguration><HeroIntervalSeconds>12</HeroIntervalSeconds><TrailerPreview>true</TrailerPreview></PluginConfiguration>");
        using var reader = System.Xml.XmlReader.Create(text, new System.Xml.XmlReaderSettings { DtdProcessing = System.Xml.DtdProcessing.Prohibit, XmlResolver = null });

        var config = (PluginConfiguration)xml.Deserialize(reader)!;

        Assert.Equal(12, config.HeroIntervalSeconds);
        Assert.False(config.HeroWaitForTrailer);
    }

    [Fact]
    public void V1WithTheOldDefaultAccent_MovesToTheNewRed()
    {
        var config = new PluginConfiguration { SchemaVersion = 1, AccentColor = "#E12D39", Sections = [new SectionDefinition { Id = Guid.NewGuid(), Type = SectionTypes.NextUp }] };

        Assert.True(ConfigMigrator.Migrate(config, [Movies]));

        Assert.Equal(PluginConfiguration.DefaultAccent, config.AccentColor);
        Assert.Equal(2, config.SchemaVersion);
    }

    [Fact]
    public void V1WithACustomAccent_KeepsIt()
    {
        var config = new PluginConfiguration { SchemaVersion = 1, AccentColor = "#3366ff", Sections = [new SectionDefinition { Id = Guid.NewGuid(), Type = SectionTypes.NextUp }] };

        ConfigMigrator.Migrate(config, [Movies]);

        Assert.Equal("#3366ff", config.AccentColor);
    }
}
