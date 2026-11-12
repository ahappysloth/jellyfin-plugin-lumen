using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using Jellyfin.Plugin.Lumen.Trakt;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// A home row of one Trakt list's titles, in Trakt's order (Trakt design note, 2026-11-12): the user's library items where
/// they have them, and with Seerr catalog cards they can request for the rest (<see cref="TraktCards"/>). Without a Trakt
/// key there's no list, and the row is hidden unless the type has a fallback (<see cref="FallbackAsync"/>, Top 10's).
/// </summary>
public abstract class TraktRowProvider : IHomeSectionProvider
{
    /// <summary>
    /// How long, from the start, the row may take before it's returned with the titles resolved so far (see
    /// <see cref="TraktCards.RowAsync"/>).
    /// </summary>
    internal static readonly TimeSpan DetailsBudget = TimeSpan.FromSeconds(4.5);

    private readonly ITraktLists _lists;
    private readonly CatalogRowAccess _access;
    private readonly TraktCards _cards;
    private readonly TimeProvider _time;

    protected TraktRowProvider(ITraktLists lists, CatalogRowAccess access, TraktCards cards, TimeProvider time)
    {
        _lists = lists;
        _access = access;
        _cards = cards;
        _time = time;
    }

    public abstract string Type { get; }

    public abstract string DisplayName { get; }

    public abstract string Description { get; }

    public virtual IReadOnlyList<SectionParameter> Parameters => [];

    /// <summary>The catalog rows' timeout: Trakt's own is shorter, and its lists are cached, so this is rarely reached.</summary>
    public TimeSpan? Timeout => CatalogSectionProvider.RowTimeout;

    /// <summary>
    /// Gets a value indicating whether the row needs Seerr: one whose titles are rarely on the server yet (Most Anticipated)
    /// would be all but empty without it, so it's hidden instead.
    /// </summary>
    protected virtual bool NeedsSeerr => false;

    /// <summary>Gets the most cards the row shows (the home's item limit applies too).</summary>
    protected virtual int MaxCards => int.MaxValue;

    public virtual IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public async Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var started = _time.GetTimestamp();
        if (Query(definition) is not { } query)
        {
            return [];
        }

        var limit = Math.Min(MaxCards, context.ItemLimit);
        var accessTask = _access.GetAsync(context.User.Id, cancellationToken);
        if (NeedsSeerr && await accessTask.ConfigureAwait(false) is null)
        {
            return [];
        }

        // Both at once otherwise: neither waits on the other, and both are usually cached.
        var listTask = _lists.GetAsync(query, cancellationToken);
        var caller = await accessTask.ConfigureAwait(false);
        var list = await listTask.ConfigureAwait(false);

        var entries = list is { Titles.Count: > 0 }
            ? await _cards.RowAsync(list.Titles, caller, context.User, limit, started, DetailsBudget, cancellationToken).ConfigureAwait(false)
            : await FallbackAsync(caller, context.User, limit, cancellationToken).ConfigureAwait(false);
        return HomeRow.Catalog(definition, RowTitle(list), entries);
    }

    /// <summary>The list the row shows for <paramref name="definition"/>, or null to show nothing.</summary>
    protected abstract TraktQuery? Query(SectionDefinition definition);

    /// <summary>The row's title on the home screen, unless the admin gave it another.</summary>
    protected abstract string RowTitle(TraktList? list);

    /// <summary>The row's cards when Trakt has nothing to give (no key, or no copy of the list yet): by default none.</summary>
    protected virtual Task<IReadOnlyList<HomeRowEntry>> FallbackAsync(
        (SeerrEndpoint Endpoint, int SeerrUserId)? caller,
        User user,
        int limit,
        CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<HomeRowEntry>>([]);
}
