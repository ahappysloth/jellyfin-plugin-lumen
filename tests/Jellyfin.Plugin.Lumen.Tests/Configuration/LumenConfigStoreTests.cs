using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Configuration;

public class LumenConfigStoreTests
{
    private readonly InMemoryPersistence _persistence = new();
    private readonly FakeLibraries _libraries = new();

    [Fact]
    public void Current_MigratesAndPersistsFreshConfigOnce()
    {
        var store = CreateStore();

        var first = store.Current;
        var second = store.Current;

        Assert.Equal(PluginConfiguration.CurrentSchemaVersion, first.SchemaVersion);
        Assert.NotEmpty(first.Sections);
        Assert.Equal(1, _persistence.SaveCount);
        Assert.Same(first, second);
    }

    [Fact]
    public void Save_RejectsInvalidConfig_WithoutPersisting()
    {
        var store = CreateStore();
        _ = store.Current;
        var invalid = new PluginConfiguration { AccentColor = "nope" };

        var result = store.Save(invalid);

        Assert.False(result.Success);
        Assert.NotEmpty(result.Errors);
        Assert.Equal(1, _persistence.SaveCount);
    }

    [Fact]
    public void Save_BumpsConfigVersion_AndStampsSchema()
    {
        var store = CreateStore();
        var before = store.Current.ConfigVersion;
        var incoming = new PluginConfiguration { SchemaVersion = 0, ConfigVersion = 999, AccentColor = "#112233" };

        var result = store.Save(incoming);

        Assert.True(result.Success);
        Assert.Equal(before + 1, _persistence.Stored.ConfigVersion);
        Assert.Equal(PluginConfiguration.CurrentSchemaVersion, _persistence.Stored.SchemaVersion);
        Assert.Equal("#112233", store.Current.AccentColor);
    }

    [Fact]
    public void ResetToDefaults_ReseedsSections_AndBumpsVersion()
    {
        var store = CreateStore();
        var before = store.Current.ConfigVersion;
        store.Save(new PluginConfiguration { Sections = [] });

        store.ResetToDefaults();

        Assert.NotEmpty(store.Current.Sections);
        Assert.Equal(before + 2, store.Current.ConfigVersion);
    }

    private LumenConfigStore CreateStore() => new(
        _persistence,
        _libraries,
        new ConfigValidator(new[] { SectionTypes.ContinueWatching, SectionTypes.NextUp, SectionTypes.RecentlyAdded, SectionTypes.BecauseYouWatched, SectionTypes.NewForYou, SectionTypes.Genre }
            .Select(t => (IHomeSectionProvider)new FakeSectionProvider(
                t,
                new SectionParameter("libraryId", "Library", SectionParameterKind.Library),
                new SectionParameter("maxRows", "Rows", SectionParameterKind.Integer),
                new SectionParameter("days", "Days", SectionParameterKind.Integer),
                new SectionParameter("genreCount", "Genres", SectionParameterKind.Integer)))),
        NullLogger<LumenConfigStore>.Instance);

    private sealed class InMemoryPersistence : IPluginConfigPersistence
    {
        public PluginConfiguration Stored { get; private set; } = new();

        public int SaveCount { get; private set; }

        public PluginConfiguration Load() => Stored;

        public void Save(PluginConfiguration configuration)
        {
            Stored = configuration;
            SaveCount++;
        }
    }

    private sealed class FakeLibraries : ILibraryCatalog
    {
        public IReadOnlyList<LibraryInfo> GetLibraries() => [new(Guid.NewGuid(), "Movies", "movies")];
    }
}
