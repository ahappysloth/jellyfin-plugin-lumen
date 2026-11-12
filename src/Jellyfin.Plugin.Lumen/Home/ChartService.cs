using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Home.Providers;
using Jellyfin.Plugin.Lumen.Trakt;
using MediaBrowser.Controller.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>One title of a chart: its place in Trakt's ranking, and its library item or catalog card.</summary>
public sealed record ChartEntry(int Rank, BaseItem? Item, CatalogItemDto? Catalog);

/// <summary>A page of a chart. <c>TotalCount</c> counts the titles the user could be shown, not Trakt's 100.</summary>
public sealed record ChartPage(IReadOnlyList<ChartEntry> Entries, int TotalCount, int StartIndex);

/// <summary>
/// The Top charts page (Trakt design note, 2026-11-12): Trakt's most watched movies or shows of a week, month, year or
/// all time, up to <see cref="TraktQuery.ChartSize"/>, with the same cards as the Trakt rows (<see cref="TraktCards"/>).
/// Unlike the Top 10 rows, every title keeps its true Trakt rank: titles the user can't be shown (not here, and no Seerr)
/// leave a gap rather than moving the rest up. Served a page at a time, so only the page's titles are looked up in Seerr,
/// and a TV draws a page of posters at a time.
/// </summary>
public sealed class ChartService
{
    public const int DefaultPageSize = 24;
    public const int MaxPageSize = 50;

    /// <summary>How long a page may wait on Seerr's descriptions before it's returned without those not in yet.</summary>
    internal static readonly TimeSpan DetailsBudget = TimeSpan.FromSeconds(6);

    private readonly ITraktLists _lists;
    private readonly CatalogRowAccess _access;
    private readonly TraktCards _cards;
    private readonly TimeProvider _time;

    public ChartService(ITraktLists lists, CatalogRowAccess access, TraktCards cards, TimeProvider time)
    {
        _lists = lists;
        _access = access;
        _cards = cards;
        _time = time;
    }

    /// <summary>Gets a value indicating whether there are charts at all (a Trakt key is saved).</summary>
    public bool Enabled => _lists.Enabled;

    /// <summary>A page of the chart, or null when Trakt can't give it (no key, or it's failing with no copy to serve).</summary>
    public async Task<ChartPage?> GetPageAsync(User user, TraktListKind kind, TraktPeriod period, int startIndex, int limit, CancellationToken cancellationToken)
    {
        var started = _time.GetTimestamp();
        startIndex = Math.Max(startIndex, 0);
        limit = Math.Clamp(limit, 1, MaxPageSize);
        var accessTask = _access.GetAsync(user.Id, cancellationToken);
        var list = await _lists.GetAsync(TraktQuery.Watched(kind, period), cancellationToken).ConfigureAwait(false);
        var caller = await accessTask.ConfigureAwait(false);
        if (list is null)
        {
            return null;
        }

        var titles = list.Titles.Count > TraktQuery.ChartSize ? list.Titles.Take(TraktQuery.ChartSize).ToList() : list.Titles;
        var owned = _cards.MatchOwned(titles, user);
        var shown = Enumerable.Range(0, titles.Count).Where(i => TraktCards.CanShow(titles, i, owned, caller is not null)).ToList();
        var page = shown.Skip(startIndex).Take(limit).ToList();
        var cards = await _cards.ResolveAsync(titles, page, owned, caller, user, started, DetailsBudget, cancellationToken).ConfigureAwait(false);

        // A title Seerr couldn't describe (or not in time) is left out of this page; it's usually there next time.
        var entries = page
            .Zip(cards, (index, card) => card is null ? null : new ChartEntry(index + 1, card.Item, card.Catalog))
            .OfType<ChartEntry>()
            .ToList();
        return new ChartPage(entries, shown.Count, startIndex);
    }
}
