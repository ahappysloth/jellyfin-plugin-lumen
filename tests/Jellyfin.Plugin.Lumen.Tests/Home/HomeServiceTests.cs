using System.Globalization;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
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
    private readonly IBadgeService _badges = Substitute.For<IBadgeService>();
    private readonly HomeCache _cache;
    private readonly User _user = TestData.User();
    private readonly PluginConfiguration _config = new() { SchemaVersion = 1, ConfigVersion = 1 };

    public HomeServiceTests()
    {
        _cache = new HomeCache(Substitute.For<IUserDataManager>(), Substitute.For<ILibraryManager>(), _time);
        _store.Current.Returns(_ => _config);
        _hero.GetHeroAsync(default!, default!, default).ReturnsForAnyArgs(Task.FromResult<IReadOnlyList<HeroItem>>([]));
        _history.GetAsync(default!, default, default).ReturnsForAnyArgs(Task.FromResult(WatchHistory.Empty));
        _badges.GetBadges(default!, default!).ReturnsForAnyArgs(new Dictionary<string, string>());
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

        // Only the slow row can time out: on a busy machine a real 200 ms could run out on the good one too.
        var good = Returning("Good", TestData.Movie("g"));
        good.TimeoutOverride = TimeSpan.FromDays(1);
        var service = new HomeService(
            [slow, good],
            _store,
            _hero,
            _history,
            new FakeMapper(),
            _badges,
            _cache,
            _time,
            NullLogger<HomeService>.Instance)
        {
            Timeout = TimeSpan.FromSeconds(3),
        };

        var building = service.GetHomeAsync(_user, CancellationToken.None);

        // The clock is fake: move it on until the slow row's 3 s are up, whenever its timer started.
        for (var i = 0; i < 2000 && !building.IsCompleted; i++)
        {
            _time.Advance(TimeSpan.FromSeconds(1));
            await Task.Delay(5);
        }

        var home = await building;

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

    [Fact]
    public async Task Badges_CoverHeroAndRowItems_ButNotGenreTiles()
    {
        var hero = TestData.Movie("hero");
        var movie = TestData.Movie("m");
        var genre = new Genre { Id = Guid.NewGuid(), Name = "Drama" };
        _hero.GetHeroAsync(default!, default!, default).ReturnsForAnyArgs(Task.FromResult<IReadOnlyList<HeroItem>>([new HeroItem(hero, null)]));
        IReadOnlyList<BaseItem>? seen = null;
        _badges.GetBadges(Arg.Any<HomeContext>(), Arg.Do<IEnumerable<BaseItem>>(i => seen = i.ToList()))
            .Returns(new Dictionary<string, string> { [movie.Id.ToString("N", CultureInfo.InvariantCulture)] = CardBadges.RecentlyAdded });
        Add("A");
        Add(SectionTypes.Genres);

        var home = await Create(Returning("A", movie), Returning(SectionTypes.Genres, genre)).GetHomeAsync(_user, CancellationToken.None);

        Assert.Equal([hero, movie], seen);
        Assert.Equal(CardBadges.RecentlyAdded, Assert.Single(home.Badges).Value);
        Assert.Equal(2, home.Rows.Count);
    }

    [Fact]
    public async Task BadgeFailure_LeavesBadgesEmpty_AndKeepsRows()
    {
        Add("A");
        _badges.GetBadges(default!, default!).ReturnsForAnyArgs(_ => throw new InvalidOperationException("boom"));

        var home = await Create(Returning("A", TestData.Movie("a"))).GetHomeAsync(_user, CancellationToken.None);

        Assert.NotNull(home.Badges);
        Assert.Empty(home.Badges);
        Assert.Single(home.Rows);
    }

    [Fact]
    public async Task RowBackdropSources_AreAppliedToCards()
    {
        var genre = new Genre { Id = Guid.NewGuid(), Name = "Drama" };
        var source = TestData.Movie("src");
        Add(SectionTypes.Genres);
        var provider = new FakeSectionProvider(SectionTypes.Genres)
        {
            Rows = (_, d, _) => Task.FromResult<IReadOnlyList<HomeRow>>(
                [new HomeRow(HomeRow.RowId(d, 0), SectionTypes.Genres, "Popular Genres", [genre]) { BackdropSources = new Dictionary<Guid, BaseItem> { [genre.Id] = source } }]),
        };

        var home = await Create(provider).GetHomeAsync(_user, CancellationToken.None);

        var card = Assert.Single(Assert.Single(home.Rows).Items);
        Assert.Equal(source.Id, card.ParentBackdropItemId);
        Assert.Equal(["tag-src"], card.ParentBackdropImageTags);
    }

    [Fact]
    public async Task CatalogRows_MapEntriesInOrder_InOneBatch_AndExistingRowsHaveNoEntries()
    {
        var owned1 = TestData.Movie("owned1");
        var owned2 = TestData.Series("owned2");
        var catalog = new CatalogItemDto("movie-605", "movie", 605, "Lumen Future", 2027, null, null, [], null, null, "None", null);
        var batches = new List<IReadOnlyList<BaseItem>>();
        IReadOnlyList<BaseItem>? badged = null;
        _badges.GetBadges(Arg.Any<HomeContext>(), Arg.Do<IEnumerable<BaseItem>>(i => badged = i.ToList())).Returns(new Dictionary<string, string>());
        Add("A");
        Add(SectionTypes.CatalogTrending);
        var provider = new FakeSectionProvider(SectionTypes.CatalogTrending)
        {
            Rows = (_, d, _) => Task.FromResult(HomeRow.Catalog(d, "Trending", [HomeRowEntry.ForItem(owned1), HomeRowEntry.ForCatalog(catalog), HomeRowEntry.ForItem(owned2)])),
        };
        var movie = TestData.Movie("a");

        var home = await Create(new FakeMapper(batches), Returning("A", movie), provider).GetHomeAsync(_user, CancellationToken.None);

        Assert.Equal(2, home.Rows.Count);
        Assert.Null(home.Rows[0].Entries);
        Assert.Equal("a", Assert.Single(home.Rows[0].Items).Name);
        var row = home.Rows[1];
        Assert.Equal(SectionTypes.CatalogTrending, row.Type);
        Assert.Empty(row.Items);
        Assert.Equal(3, row.Entries!.Count);
        Assert.Equal(("owned1", null), (row.Entries[0].Item!.Name, row.Entries[0].Catalog));
        Assert.Equal((null, catalog), (row.Entries[1].Item, row.Entries[1].Catalog));
        Assert.Equal(("owned2", null), (row.Entries[2].Item!.Name, row.Entries[2].Catalog));
        Assert.Contains(batches, b => b.SequenceEqual([owned1, owned2]));
        Assert.Equal([movie, owned1, owned2], badged);
    }

    [Fact]
    public async Task CatalogRow_WithOnlyCatalogEntries_IsKept_AndEmptyCatalogRowIsOmitted()
    {
        var catalog = new CatalogItemDto("tv-1", "tv", 1, "T", null, null, null, [], null, null, "None", null);
        Add("Full");
        Add("Empty");
        var full = new FakeSectionProvider("Full") { Rows = (_, d, _) => Task.FromResult(HomeRow.Catalog(d, "Full", [HomeRowEntry.ForCatalog(catalog)])) };
        var empty = new FakeSectionProvider("Empty")
        {
            Rows = (_, d, _) => Task.FromResult<IReadOnlyList<HomeRow>>([new HomeRow(HomeRow.RowId(d, 0), "Empty", "t", []) { Entries = [] }]),
        };

        var home = await Create(full, empty).GetHomeAsync(_user, CancellationToken.None);

        var row = Assert.Single(home.Rows);
        Assert.Equal(catalog, Assert.Single(row.Entries!).Catalog);
    }

    [Fact]
    public async Task RequestsDuringABuild_ShareIt_AndACallerGivingUpDoesntCancelIt()
    {
        Add("Slow");
        var release = new TaskCompletionSource();
        var builds = 0;
        var provider = new FakeSectionProvider("Slow")
        {
            TimeoutOverride = TimeSpan.FromSeconds(30),
            Rows = async (_, d, _) =>
            {
                Interlocked.Increment(ref builds);
                await release.Task;
                return HomeRow.Single(d, "Slow", [TestData.Movie("s")]);
            },
        };
        var service = new HomeService([provider], _store, _hero, _history, new FakeMapper(), _badges, _cache, TimeProvider.System, NullLogger<HomeService>.Instance);

        using var leaving = new CancellationTokenSource();
        var first = service.GetHomeAsync(_user, leaving.Token);
        var second = service.GetHomeAsync(_user, CancellationToken.None);
        await leaving.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        release.SetResult();

        Assert.Equal(["Slow"], (await second).Rows.Select(r => r.Type));
        Assert.Equal(1, builds);
    }

    [Fact]
    public async Task ARequestAfterTheUsersChange_DoesntJoinABuildFromBeforeIt()
    {
        Add("Slow");
        var release = new TaskCompletionSource();
        var builds = 0;
        var provider = new FakeSectionProvider("Slow")
        {
            TimeoutOverride = TimeSpan.FromSeconds(30),
            Rows = async (_, d, _) =>
            {
                var build = Interlocked.Increment(ref builds);
                await release.Task;
                return HomeRow.Single(d, "Slow", [TestData.Movie("build " + build)]);
            },
        };
        var service = new HomeService([provider], _store, _hero, _history, new FakeMapper(), _badges, _cache, TimeProvider.System, NullLogger<HomeService>.Instance);

        var before = service.GetHomeAsync(_user, CancellationToken.None);
        _cache.InvalidateUser(_user.Id); // e.g. marked watched while the first build runs
        var after = service.GetHomeAsync(_user, CancellationToken.None);
        release.SetResult();
        await Task.WhenAll(before, after);

        Assert.Equal(2, builds);
    }

    [Fact]
    public async Task ProviderTimeoutOverride_IsUsed()
    {
        Add("Patient");
        var provider = new FakeSectionProvider("Patient")
        {
            TimeoutOverride = TimeSpan.FromSeconds(30),
            Rows = async (_, d, ct) =>
            {
                await Task.Delay(400, ct);
                return HomeRow.Single(d, "Patient", [TestData.Movie("p")]);
            },
        };
        var service = new HomeService([provider], _store, _hero, _history, new FakeMapper(), _badges, _cache, TimeProvider.System, NullLogger<HomeService>.Instance)
        {
            Timeout = TimeSpan.FromMilliseconds(100),
        };

        var home = await service.GetHomeAsync(_user, CancellationToken.None);

        Assert.Equal(["Patient"], home.Rows.Select(r => r.Type));
    }

    [Fact]
    public async Task AbandonedWork_KeepsItsSlot_SoItCantPileUp()
    {
        Add("S");
        using var stuck = new ManualResetEventSlim();
        var calls = 0;
        var provider = new FakeSectionProvider("S")
        {
            Rows = (_, def, _) =>
            {
                if (Interlocked.Increment(ref calls) == 1)
                {
                    stuck.Wait(TimeSpan.FromSeconds(10), CancellationToken.None); // a synchronous library query that ignores its token
                }

                return Task.FromResult(HomeRow.Single(def, "S", [TestData.Movie("s")]));
            },
        };
        using var slots = new SemaphoreSlim(1);
        var service = new HomeService([provider], _store, _hero, _history, new FakeMapper(), _badges, _cache, TimeProvider.System, NullLogger<HomeService>.Instance)
        {
            Timeout = TimeSpan.FromMilliseconds(200),
            WorkSlots = slots,
        };

        Assert.Empty((await service.GetHomeAsync(TestData.User("a"), CancellationToken.None)).Rows);
        Assert.Empty((await service.GetHomeAsync(TestData.User("b"), CancellationToken.None)).Rows); // waits for the slot, times out
        Assert.Equal(1, calls);

        stuck.Set();
        for (var i = 0; i < 100 && slots.CurrentCount == 0; i++)
        {
            await Task.Delay(20);
        }

        Assert.Single((await service.GetHomeAsync(TestData.User("c"), CancellationToken.None)).Rows);
    }

    private static FakeSectionProvider Returning(string type, params BaseItem[] items) => new(type)
    {
        Rows = (_, def, _) => Task.FromResult(HomeRow.Single(def, type, items)),
    };

    private HomeService Create(params IHomeSectionProvider[] providers) => Create(new FakeMapper(), providers);

    private HomeService Create(FakeMapper mapper, params IHomeSectionProvider[] providers) =>
        new(providers, _store, _hero, _history, mapper, _badges, _cache, _time, NullLogger<HomeService>.Instance);

    private SectionDefinition Add(string type, bool enabled = true)
    {
        var section = TestData.Section(type);
        section.Enabled = enabled;
        _config.Sections.Add(section);
        return section;
    }

    private sealed class FakeMapper : IHomeDtoMapper
    {
        private readonly List<IReadOnlyList<BaseItem>>? _batches;

        public FakeMapper(List<IReadOnlyList<BaseItem>>? batches = null)
        {
            _batches = batches;
        }

        public IReadOnlyList<BaseItemDto> MapCards(IReadOnlyList<BaseItem> items, User user)
        {
            _batches?.Add(items.ToList());
            return items.Select(i => new BaseItemDto { Id = i.Id, Name = i.Name }).ToList();
        }

        public BaseItemDto MapHero(BaseItem item, User user) => new() { Id = item.Id, Name = item.Name };

        public void ApplyBackdropSources(IReadOnlyList<BaseItemDto> cards, IReadOnlyDictionary<Guid, BaseItem> sources, User user)
        {
            foreach (var card in cards.Where(c => sources.ContainsKey(c.Id)))
            {
                card.ParentBackdropItemId = sources[card.Id].Id;
                card.ParentBackdropImageTags = ["tag-" + sources[card.Id].Name];
            }
        }
    }
}
