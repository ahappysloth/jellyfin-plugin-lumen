using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public sealed class HomeServiceTests : IDisposable
{
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly ILumenConfigStore _store = Substitute.For<ILumenConfigStore>();
    private readonly IHeroService _hero = Substitute.For<IHeroService>();
    private readonly IWatchHistoryService _history = Substitute.For<IWatchHistoryService>();
    private readonly HomeCache _cache;
    private readonly User _user = TestData.User();
    private readonly PluginConfiguration _config = new() { SchemaVersion = 1, ConfigVersion = 1 };

    public HomeServiceTests()
    {
        _cache = new HomeCache(Substitute.For<IUserDataManager>(), Substitute.For<ILibraryManager>(), _time);
        _store.Current.Returns(_ => _config);
        _hero.GetHeroAsync(default!, default!, default).ReturnsForAnyArgs(Task.FromResult<IReadOnlyList<HeroItem>>([]));
        _history.GetAsync(default!, default, default).ReturnsForAnyArgs(Task.FromResult(WatchHistory.Empty));
    }

    public void Dispose() => _cache.Dispose();

    [Fact]
    public async Task ReturnsRowsInConfiguredOrder_AndSkipsDisabled()
    {
        Add("B");
        Add("A");
        Add("C", enabled: false);

        var home = await Create(Returning("A", TestData.Movie("a")), Returning("B", TestData.Movie("b")), Returning("C", TestData.Movie("c")))
            .GetHomeAsync(_user, CancellationToken.None);

        Assert.Equal(["B", "A"], home.Rows.Select(r => r.Type));
        Assert.Equal("b", home.Rows[0].Items[0].Name);
        Assert.Equal(1, home.ConfigVersion);
    }

    [Fact]
    public async Task OmitsEmptyRows()
    {
        var def = Add("Empty");
        var provider = new FakeSectionProvider("Empty")
        {
            Rows = (_, d, _) => Task.FromResult<IReadOnlyList<HomeRow>>([new HomeRow(HomeRow.RowId(d, 0), "Empty", "t", [])]),
        };

        var home = await Create(provider).GetHomeAsync(_user, CancellationToken.None);

        Assert.Empty(home.Rows);
        Assert.Empty(home.Hero);
    }

    [Fact]
    public async Task FailingProvider_IsIsolated()
    {
        Add("Bad");
        Add("Good");
        var bad = new FakeSectionProvider("Bad") { Rows = (_, _, _) => throw new InvalidOperationException("boom") };

        var home = await Create(bad, Returning("Good", TestData.Movie("g"))).GetHomeAsync(_user, CancellationToken.None);

        Assert.Equal(["Good"], home.Rows.Select(r => r.Type));
    }

    [Fact]
    public async Task SlowProvider_TimesOut()
    {
        Add("Slow");
        Add("Good");
        var slow = new FakeSectionProvider("Slow")
        {
            Rows = async (_, _, ct) =>
            {
                await Task.Delay(Timeout.Infinite, ct);
                return [];
            },
        };

        var service = new HomeService(
            [slow, Returning("Good", TestData.Movie("g"))],
            _store,
            _hero,
            _history,
            new FakeMapper(),
            _cache,
            TimeProvider.System,
            NullLogger<HomeService>.Instance)
        {
            Timeout = TimeSpan.FromMilliseconds(200),
        };

        var home = await service.GetHomeAsync(_user, CancellationToken.None);

        Assert.Equal(["Good"], home.Rows.Select(r => r.Type));
    }

    [Fact]
    public async Task UnknownType_AndInvalidDefinition_AreSkipped()
    {
        Add("Missing");
        Add("Picky");
        var picky = Returning("Picky", TestData.Movie("p"));
        picky.ValidateRule = _ => ["bad params"];

        var home = await Create(picky).GetHomeAsync(_user, CancellationToken.None);

        Assert.Empty(home.Rows);
    }

    [Fact]
    public async Task HeroFailure_ReturnsEmptyHero_AndRows()
    {
        Add("A");
        _hero.GetHeroAsync(default!, default!, default).ReturnsForAnyArgs(Task.FromException<IReadOnlyList<HeroItem>>(new InvalidOperationException()));

        var home = await Create(Returning("A", TestData.Movie("a"))).GetHomeAsync(_user, CancellationToken.None);

        Assert.Empty(home.Hero);
        Assert.Single(home.Rows);
    }

    [Fact]
    public async Task MapsHeroItems_WithTrailerIds()
    {
        var movie = TestData.Movie("hero");
        var trailer = Guid.NewGuid();
        _hero.GetHeroAsync(default!, default!, default).ReturnsForAnyArgs(Task.FromResult<IReadOnlyList<HeroItem>>([new HeroItem(movie, trailer)]));

        var home = await Create().GetHomeAsync(_user, CancellationToken.None);

        var hero = Assert.Single(home.Hero);
        Assert.Equal("hero", hero.Item.Name);
        Assert.Equal(trailer, hero.TrailerItemId);
    }

    [Fact]
    public async Task UsesCache_UntilConfigVersionChanges()
    {
        Add("A");
        var calls = 0;
        var provider = new FakeSectionProvider("A")
        {
            Rows = (_, def, _) =>
            {
                calls++;
                return Task.FromResult(HomeRow.Single(def, "A", [TestData.Movie("a")]));
            },
        };
        var service = Create(provider);

        await service.GetHomeAsync(_user, CancellationToken.None);
        await service.GetHomeAsync(_user, CancellationToken.None);
        _config.ConfigVersion = 2;
        await service.GetHomeAsync(_user, CancellationToken.None);

        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task DegradedResponse_IsCachedOnlyBrieflyWhileHealthyOneIsCachedFully()
    {
        Add("Flaky");
        var calls = 0;
        var provider = new FakeSectionProvider("Flaky")
        {
            Rows = (_, def, _) =>
            {
                calls++;
                return calls == 1
                    ? throw new InvalidOperationException("boom")
                    : Task.FromResult(HomeRow.Single(def, "Flaky", [TestData.Movie("f")]));
            },
        };
        var service = Create(provider);

        var degraded = await service.GetHomeAsync(_user, CancellationToken.None);
        await service.GetHomeAsync(_user, CancellationToken.None);
        Assert.Empty(degraded.Rows);
        Assert.Equal(1, calls);

        _time.Advance(HomeCache.DegradedTtl + TimeSpan.FromSeconds(1));
        var healthy = await service.GetHomeAsync(_user, CancellationToken.None);
        Assert.Single(healthy.Rows);
        Assert.Equal(2, calls);

        _time.Advance(HomeCache.DegradedTtl + TimeSpan.FromSeconds(1));
        await service.GetHomeAsync(_user, CancellationToken.None);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task WatchHistory_IsComputedOncePerBuild()
    {
        Add("A");
        Add("B");
        FakeSectionProvider UsesHistory(string type) => new(type)
        {
            Rows = async (ctx, def, _) =>
            {
                await ctx.GetWatchHistoryAsync();
                return HomeRow.Single(def, type, [TestData.Movie(type)]);
            },
        };

        await Create(UsesHistory("A"), UsesHistory("B")).GetHomeAsync(_user, CancellationToken.None);

        await _history.ReceivedWithAnyArgs(1).GetAsync(default!, default, default);
    }

    private static FakeSectionProvider Returning(string type, params BaseItem[] items) => new(type)
    {
        Rows = (_, def, _) => Task.FromResult(HomeRow.Single(def, type, items)),
    };

    private HomeService Create(params IHomeSectionProvider[] providers) =>
        new(providers, _store, _hero, _history, new FakeMapper(), _cache, _time, NullLogger<HomeService>.Instance);

    private SectionDefinition Add(string type, bool enabled = true)
    {
        var section = TestData.Section(type);
        section.Enabled = enabled;
        _config.Sections.Add(section);
        return section;
    }

    private sealed class FakeMapper : IHomeDtoMapper
    {
        public IReadOnlyList<BaseItemDto> MapCards(IReadOnlyList<BaseItem> items, User user) =>
            items.Select(i => new BaseItemDto { Id = i.Id, Name = i.Name }).ToList();

        public BaseItemDto MapHero(BaseItem item, User user) => new() { Id = item.Id, Name = item.Name };
    }
}
