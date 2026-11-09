using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Dto;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Builds the home response for a user.</summary>
public interface IHomeService
{
    Task<HomeResponseDto> GetHomeAsync(User user, CancellationToken cancellationToken);
}

/// <summary>Selects hero items.</summary>
public interface IHeroService
{
    Task<IReadOnlyList<HeroItem>> GetHeroAsync(HomeContext context, PluginConfiguration config, CancellationToken cancellationToken);
}

/// <summary>A hero slide: the item and its local trailer, if any.</summary>
public sealed record HeroItem(BaseItem Item, Guid? TrailerItemId);

/// <summary>
/// Runs the enabled section providers in parallel, each with its own timeout and exception boundary, and assembles the
/// response in configured order, then adds card badges (also guarded; a failure leaves them empty). Results are cached
/// per user in <see cref="HomeCache"/>.
/// <para>
/// Providers make synchronous library queries that can't be interrupted, so a provider that times out is cancelled (it
/// checks its token between queries) but may run on for a while. At most <see cref="MaxConcurrentWork"/> pieces of
/// provider work run at once across all users, abandoned ones included, so a slow database can't pile up work on the
/// thread pool: new work waits for a slot, inside its own timeout.
/// </para>
/// </summary>
public sealed class HomeService : IHomeService
{
    public static readonly TimeSpan ProviderTimeout = TimeSpan.FromSeconds(3);

    /// <summary>Enough for a few home loads at once (a load runs one piece per section, plus hero and badges).</summary>
    public static readonly int MaxConcurrentWork = Math.Max(32, Environment.ProcessorCount * 4);

    private readonly Dictionary<string, IHomeSectionProvider> _providers;
    private readonly ILumenConfigReader _config;
    private readonly IHeroService _hero;
    private readonly IWatchHistoryService _history;
    private readonly IHomeDtoMapper _mapper;
    private readonly IBadgeService _badges;
    private readonly HomeCache _cache;
    private readonly TimeProvider _time;
    private readonly ILogger<HomeService> _logger;

    public HomeService(
        IEnumerable<IHomeSectionProvider> providers,
        ILumenConfigReader config,
        IHeroService hero,
        IWatchHistoryService history,
        IHomeDtoMapper mapper,
        IBadgeService badges,
        HomeCache cache,
        TimeProvider time,
        ILogger<HomeService> logger)
    {
        _providers = providers.ToDictionary(p => p.Type, StringComparer.OrdinalIgnoreCase);
        _config = config;
        _hero = hero;
        _history = history;
        _mapper = mapper;
        _badges = badges;
        _cache = cache;
        _time = time;
        _logger = logger;
    }

    /// <summary>Per-provider timeout; overridable so tests need not race a fake clock against the thread pool.</summary>
    internal TimeSpan Timeout { get; init; } = ProviderTimeout;

    /// <summary>Gets the gate on concurrently running provider work (see the class remarks); replaceable for tests.</summary>
    internal SemaphoreSlim WorkSlots { get; init; } = new(MaxConcurrentWork);

    public async Task<HomeResponseDto> GetHomeAsync(User user, CancellationToken cancellationToken)
    {
        var config = _config.Current;
        if (_cache.TryGet(user.Id, config.ConfigVersion, out var cached))
        {
            return cached;
        }

        var stamp = _cache.Stamp(user.Id);
        var build = new BuildState();
        var response = await BuildAsync(user, config, build, cancellationToken);
        _cache.Set(user.Id, config.ConfigVersion, stamp, response, build.Degraded);
        return response;
    }

    private async Task<HomeResponseDto> BuildAsync(User user, PluginConfiguration config, BuildState build, CancellationToken cancellationToken)
    {
        var now = _time.GetUtcNow();
        var context = new HomeContext(user, now, () => _history.GetAsync(user, now, cancellationToken));

        var heroTask = RunGuardedAsync("hero", ct => _hero.GetHeroAsync(context, config, ct), (IReadOnlyList<HeroItem>)[], Timeout, build, cancellationToken);
        var sectionTasks = config.Sections.Where(s => s.Enabled).Select(s => RunSectionAsync(context, s, build, cancellationToken)).ToList();

        var sections = await Task.WhenAll(sectionTasks);
        var hero = await heroTask;

        var rows = sections.SelectMany(r => r).Where(r => r.HasContent).ToList();
        var rowDtos = rows.Select(r => new HomeRowDto(r.Id, r.Type, r.Title, MapRow(r, user)) { Entries = MapEntries(r, user) }).ToList();
        var heroDtos = hero.Select(h => new HeroItemDto(_mapper.MapHero(h.Item, user), h.TrailerItemId)).ToList();

        // Genre tiles are not titles, so they never get a badge.
        var badged = hero.Select(h => h.Item)
            .Concat(rows.Where(r => r.Type != SectionTypes.Genres).SelectMany(r => r.Items))
            .Concat(rows.SelectMany(r => r.Entries ?? []).Select(e => e.Item).OfType<BaseItem>())
            .ToList();
        var badges = await RunGuardedAsync(
            "badges",
            _ => Task.FromResult(_badges.GetBadges(context, badged)),
            (IReadOnlyDictionary<string, string>)new Dictionary<string, string>(),
            Timeout,
            build,
            cancellationToken);

        return new HomeResponseDto(config.ConfigVersion, heroDtos, rowDtos, badges);
    }

    private IReadOnlyList<BaseItemDto> MapRow(HomeRow row, User user)
    {
        var cards = _mapper.MapCards(row.Items, user);
        if (row.BackdropSources is { Count: > 0 } sources)
        {
            _mapper.ApplyBackdropSources(cards, sources, user);
        }

        return cards;
    }

    /// <summary>A catalog row's entries in order, their library items mapped in one batch; null for other rows.</summary>
    private List<HomeRowEntryDto>? MapEntries(HomeRow row, User user)
    {
        if (row.Entries is null)
        {
            return null;
        }

        var items = row.Entries.Select(e => e.Item).OfType<BaseItem>().ToList();
        IReadOnlyList<BaseItemDto> mapped = items.Count == 0 ? [] : _mapper.MapCards(items, user);
        using var cards = mapped.GetEnumerator();
        var entries = new List<HomeRowEntryDto>(row.Entries.Count);
        foreach (var entry in row.Entries)
        {
            if (entry.Item is not null)
            {
                if (cards.MoveNext())
                {
                    entries.Add(new HomeRowEntryDto(cards.Current, null));
                }
            }
            else if (entry.Catalog is not null)
            {
                entries.Add(new HomeRowEntryDto(null, entry.Catalog));
            }
        }

        return entries;
    }

    private Task<IReadOnlyList<HomeRow>> RunSectionAsync(HomeContext context, SectionDefinition section, BuildState build, CancellationToken cancellationToken)
    {
        if (!_providers.TryGetValue(section.Type, out var provider))
        {
            _logger.LogWarning("Lumen skipped section {SectionId}: unknown type {Type}", section.Id, section.Type);
            return Task.FromResult<IReadOnlyList<HomeRow>>([]);
        }

        var errors = provider.Validate(section);
        if (errors.Count > 0)
        {
            _logger.LogWarning("Lumen skipped section {SectionId} ({Type}): {Errors}", section.Id, section.Type, string.Join("; ", errors));
            return Task.FromResult<IReadOnlyList<HomeRow>>([]);
        }

        return RunGuardedAsync($"section {section.Id} ({section.Type})", ct => provider.GetRowsAsync(context, section, ct), (IReadOnlyList<HomeRow>)[], provider.Timeout ?? Timeout, build, cancellationToken);
    }

    private async Task<T> RunGuardedAsync<T>(string label, Func<CancellationToken, Task<T>> work, T fallback, TimeSpan timeout, BuildState build, CancellationToken cancellationToken)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        try
        {
            // Task.Run: providers make synchronous library calls; this lets them run in parallel and be abandoned on timeout.
            // The slot is held until the work really ends, even after the timeout gives up on it.
            return await Task.Run(
                async () =>
                {
                    await WorkSlots.WaitAsync(linked.Token).ConfigureAwait(false);
                    try
                    {
                        return await work(linked.Token).ConfigureAwait(false);
                    }
                    finally
                    {
                        WorkSlots.Release();
                    }
                },
                linked.Token).WaitAsync(timeout, _time, cancellationToken);
        }
        catch (TimeoutException)
        {
            build.MarkDegraded();
            await linked.CancelAsync();
            _logger.LogWarning("Lumen {Label} timed out after {Timeout}", label, timeout);
            return fallback;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            build.MarkDegraded();
            _logger.LogWarning(ex, "Lumen {Label} failed", label);
            return fallback;
        }
    }

    /// <summary>Tracks whether any part of one build hit its failure or timeout fallback.</summary>
    private sealed class BuildState
    {
        private int _degraded;

        public bool Degraded => Volatile.Read(ref _degraded) != 0;

        public void MarkDegraded() => Volatile.Write(ref _degraded, 1);
    }
}
