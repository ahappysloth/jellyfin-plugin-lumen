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

    [Fact]
    public void Save_WithoutAKey_KeepsTheStoredSeerrKey()
    {
        var store = CreateStore();
        Assert.True(store.Save(new PluginConfiguration { SeerrUrl = "http://seerr:5055", SeerrApiKey = "stored" }).Success);

        var fromAdminPage = new PluginConfiguration { SeerrUrl = "http://seerr:5055/", SeerrApiKey = "stored" }.WithoutSecrets();
        fromAdminPage.AccentColor = "#123456";
        Assert.True(store.Save(fromAdminPage).Success);

        Assert.Equal("stored", _persistence.Stored.SeerrApiKey);
        Assert.Equal("#123456", _persistence.Stored.AccentColor);
    }

    [Fact]
    public void Save_WithoutAKey_ForANewSeerrAddress_DropsTheStoredKey()
    {
        var store = CreateStore();
        Assert.True(store.Save(new PluginConfiguration { SeerrUrl = "http://seerr:5055", SeerrApiKey = "stored" }).Success);

        // Requests off, so a missing key isn't a validation error; the old key must not follow the new address.
        Assert.True(store.Save(new PluginConfiguration { SeerrUrl = "http://other:5055" }).Success);

        Assert.Null(_persistence.Stored.SeerrApiKey);
    }

    [Fact]
    public void SeerrKey_IsWriteOnlyInJson_ButStillPersisted()
    {
        var config = new PluginConfiguration { SeerrApiKey = "stored" };

        var json = System.Text.Json.JsonSerializer.Serialize(config);
        Assert.DoesNotContain("stored", json, StringComparison.Ordinal);

        var posted = System.Text.Json.JsonSerializer.Deserialize<PluginConfiguration>("{\"SeerrApiKey\":\"typed\"}")!;
        Assert.Equal("typed", posted.SeerrApiKey);

        var xml = new System.Xml.Serialization.XmlSerializer(typeof(PluginConfiguration));
        using var writer = new StringWriter();
        xml.Serialize(writer, config);
        Assert.Contains("<SeerrApiKey>stored</SeerrApiKey>", writer.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void Save_NormalizesTheQuickConnectAddress_AndStoresBlankAsNotSet()
    {
        var store = CreateStore();
        Assert.True(store.Save(new PluginConfiguration { QuickConnectAddress = "  https://jf.example.com  " }).Success);
        Assert.Equal("https://jf.example.com", _persistence.Stored.QuickConnectAddress);

        // Copied from the address bar: stored without jellyfin-web's /web/, which the QR code adds itself.
        Assert.True(store.Save(new PluginConfiguration { QuickConnectAddress = "https://jf.example.com/base/web/" }).Success);
        Assert.Equal("https://jf.example.com/base", _persistence.Stored.QuickConnectAddress);
        Assert.True(store.Save(new PluginConfiguration { QuickConnectAddress = "   " }).Success);
        Assert.Null(_persistence.Stored.QuickConnectAddress);
    }

    [Fact]
    public void Save_WithoutATraktKey_KeepsTheStoredOne_AndTheClearFlagRemovesIt()
    {
        var store = CreateStore();
        Assert.True(store.Save(new PluginConfiguration { TraktClientId = "  0123456789abcdef  " }).Success);
        Assert.Equal("0123456789abcdef", _persistence.Stored.TraktClientId);

        var fromAdminPage = _persistence.Stored.WithoutSecrets();
        Assert.True(fromAdminPage.TraktClientIdSet);
        Assert.Null(fromAdminPage.TraktClientId);
        Assert.True(store.Save(fromAdminPage).Success);
        Assert.Equal("0123456789abcdef", _persistence.Stored.TraktClientId);

        var clearing = _persistence.Stored.WithoutSecrets();
        clearing.ClearTraktClientId = true;
        Assert.True(store.Save(clearing).Success);
        Assert.Null(_persistence.Stored.TraktClientId);
        Assert.False(_persistence.Stored.ClearTraktClientId);
    }

    [Fact]
    public void Save_WithANewTraktKey_ReplacesTheStoredOne()
    {
        var store = CreateStore();
        Assert.True(store.Save(new PluginConfiguration { TraktClientId = "0123456789abcdef" }).Success);

        Assert.True(store.Save(new PluginConfiguration { TraktClientId = "fedcba9876543210" }).Success);

        Assert.Equal("fedcba9876543210", _persistence.Stored.TraktClientId);
    }

    [Fact]
    public void TraktKey_IsWriteOnlyInJson_ButStillPersisted()
    {
        var config = new PluginConfiguration { TraktClientId = "trakt-secret-key", SeerrApiKey = "seerr-secret-key" };

        // Jellyfin's own GET /Plugins/{id}/Configuration serializes the stored object itself; the admin page gets a copy.
        foreach (var sent in new[] { config, config.WithoutSecrets() })
        {
            var json = System.Text.Json.JsonSerializer.Serialize(sent);
            Assert.DoesNotContain("trakt-secret-key", json, StringComparison.Ordinal);
            Assert.DoesNotContain("seerr-secret-key", json, StringComparison.Ordinal);
        }

        Assert.Contains("\"TraktClientIdSet\":true", System.Text.Json.JsonSerializer.Serialize(config.WithoutSecrets()), StringComparison.Ordinal);
        Assert.Equal("trakt-secret-key", config.TraktClientId);

        var posted = System.Text.Json.JsonSerializer.Deserialize<PluginConfiguration>("{\"TraktClientId\":\"typed\",\"ClearTraktClientId\":true}")!;
        Assert.Equal("typed", posted.TraktClientId);
        Assert.True(posted.ClearTraktClientId);

        var xml = new System.Xml.Serialization.XmlSerializer(typeof(PluginConfiguration));
        using var writer = new StringWriter();
        xml.Serialize(writer, config);
        Assert.Contains("<TraktClientId>trakt-secret-key</TraktClientId>", writer.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain("TraktClientIdSet", writer.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain("ClearTraktClientId", writer.ToString(), StringComparison.Ordinal);
    }

    private LumenConfigStore CreateStore() => new(
        new LumenConfigReader(_persistence, _libraries, NullLogger<LumenConfigReader>.Instance),
        new ConfigValidator(new[] { SectionTypes.ContinueWatching, SectionTypes.NextUp, SectionTypes.RecentlyAdded, SectionTypes.BecauseYouWatched, SectionTypes.NewForYou, SectionTypes.Genre }
            .Select(t => (IHomeSectionProvider)new FakeSectionProvider(
                t,
                new SectionParameter("libraryId", "Library", SectionParameterKind.Library),
                new SectionParameter("maxRows", "Rows", SectionParameterKind.Integer),
                new SectionParameter("days", "Days", SectionParameterKind.Integer),
                new SectionParameter("genreCount", "Genres", SectionParameterKind.Integer)))));

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
