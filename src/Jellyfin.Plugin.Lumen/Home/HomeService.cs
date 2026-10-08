using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
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
/// response in configured order. Results are cached per user in <see cref="HomeCache"/>.
/// </summary>
public sealed class HomeService : IHomeService
{
    public static readonly TimeSpan ProviderTimeout = TimeSpan.FromSeconds(3);

    private readonly Dictionary<string, IHomeSectionProvider> _providers;
    private readonly ILumenConfigStore _config;
    private readonly IHeroService _hero;
    private readonly IWatchHistoryService _history;
    private readonly IHomeDtoMapper _mapper;
    private readonly HomeCache _cache;
    private readonly TimeProvider _time;
    private readonly ILogger<HomeService> _logger;

    public HomeService(
        IEnumerable<IHomeSectionProvider> providers,
        ILumenConfigStore config,
        IHeroService hero,
        IWatchHistoryService history,
        IHomeDtoMapper mapper,
        HomeCache cache,
        TimeProvider time,
        ILogger<HomeService> logger)
    {
        _providers = providers.ToDictionary(p => p.Type, StringComparer.OrdinalIgnoreCase);
        _config = config;
        _hero = hero;
        _history = history;
        _mapper = mapper;
        _cache = cache;
        _time = time;
        _logger = logger;
    }

    /// <summary>Per-provider timeout; overridable so tests need not race a fake clock against the thread pool.</summary>
    internal TimeSpan Timeout { get; init; } = ProviderTimeout;

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

        var heroTask = RunGuardedAsync("hero", ct => _hero.GetHeroAsync(context, config, ct), (IReadOnlyList<HeroItem>)[], build, cancellationToken);
        var sectionTasks = config.Sections.Where(s => s.Enabled).Select(s => RunSectionAsync(context, s, build, cancellationToken)).ToList();

        var sections = await Task.WhenAll(sectionTasks);
        var hero = await heroTask;

        var rows = sections
            .SelectMany(r => r)
            .Where(r => r.Items.Count > 0)
            .Select(r => new HomeRowDto(r.Id, r.Type, r.Title, _mapper.MapCards(r.Items, user)))
            .ToList();
        var heroDtos = hero.Select(h => new HeroItemDto(_mapper.MapHero(h.Item, user), h.TrailerItemId)).ToList();

        return new HomeResponseDto(config.ConfigVersion, heroDtos, rows);
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

        return RunGuardedAsync($"section {section.Id} ({section.Type})", ct => provider.GetRowsAsync(context, section, ct), (IReadOnlyList<HomeRow>)[], build, cancellationToken);
    }

    private async Task<T> RunGuardedAsync<T>(string label, Func<CancellationToken, Task<T>> work, T fallback, BuildState build, CancellationToken cancellationToken)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        try
        {
            // Task.Run: providers make synchronous library calls; this lets them run in parallel and be abandoned on timeout.
            return await Task.Run(() => work(linked.Token), linked.Token).WaitAsync(Timeout, _time, cancellationToken);
        }
        catch (TimeoutException)
        {
            build.MarkDegraded();
            await linked.CancelAsync();
            _logger.LogWarning("Lumen {Label} timed out after {Timeout}", label, Timeout);
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
