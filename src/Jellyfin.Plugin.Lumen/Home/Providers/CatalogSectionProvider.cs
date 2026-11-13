using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// Base for the Seerr-backed rows (requests design spec, §5.1). Only users with catalog access get a row; any Seerr
/// failure drops the row quietly. Titles the user can already watch become their real Jellyfin item, so they render
/// as normal playable cards; the rest are catalog cards.
/// </summary>
public abstract class CatalogSectionProvider : IHomeSectionProvider
{
    /// <summary>
    /// Longer than <see cref="SeerrClient.Timeout"/>, so a hung Seerr fails the call (and counts towards the circuit
    /// breaker) before the home guard abandons the row; a cold My Requests also needs a detail call per title.
    /// </summary>
    public static readonly TimeSpan RowTimeout = SeerrClient.Timeout + TimeSpan.FromSeconds(1);

    private readonly CatalogRowAccess _access;
    private readonly ILogger _logger;

    protected CatalogSectionProvider(CatalogRowAccess access, ISeerrClient seerr, CatalogMapper mapper, ILogger logger)
    {
        _access = access;
        Seerr = seerr;
        Mapper = mapper;
        _logger = logger;
    }

    public abstract string Type { get; }

    public abstract string DisplayName { get; }

    public abstract string Description { get; }

    public IReadOnlyList<SectionParameter> Parameters => [];

    public TimeSpan? Timeout => RowTimeout;

    protected ISeerrClient Seerr { get; }

    protected CatalogMapper Mapper { get; }

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public async Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        if (await _access.GetAsync(context.User.Id, cancellationToken).ConfigureAwait(false) is not { } caller)
        {
            return [];
        }

        var (endpoint, seerrUserId) = caller;

        IReadOnlyList<CatalogItemDto> items;
        try
        {
            items = await GetItemsAsync(endpoint, seerrUserId, context, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException e)
        {
            // Fail open: the row just disappears. The breaker already logs outages once.
            if (!e.IsCircuitOpen && _logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug("Lumen dropped the {Type} row: {Message}", Type, e.LogText);
            }

            return [];
        }

        return HomeRow.Catalog(definition, DisplayName, ToEntries(items, context.User).Take(context.ItemLimit).ToList());
    }

    /// <summary>The row's titles in display order (at least <see cref="HomeContext.ItemLimit"/> if there are that many).</summary>
    protected abstract Task<IReadOnlyList<CatalogItemDto>> GetItemsAsync(SeerrEndpoint endpoint, int seerrUserId, HomeContext context, CancellationToken cancellationToken);

    /// <summary>Catalog items for a discover result list; results without a media type are taken to be <paramref name="defaultType"/>.</summary>
    protected IEnumerable<(SeerrMedia Media, CatalogItemDto Item)> Map(IEnumerable<SeerrMedia>? results, string? defaultType, User user)
    {
        foreach (var media in results ?? [])
        {
            if (Mapper.ToItem(media.MediaType ?? defaultType ?? string.Empty, media, user) is { } item)
            {
                yield return (media, item);
            }
        }
    }

    private IEnumerable<HomeRowEntry> ToEntries(IEnumerable<CatalogItemDto> items, User user)
    {
        var seen = new HashSet<Guid>();
        foreach (var item in items)
        {
            if (Mapper.VisibleItem(item.JellyfinItemId, user) is { } owned)
            {
                if (seen.Add(owned.Id))
                {
                    yield return HomeRowEntry.ForItem(owned);
                }
            }
            else
            {
                yield return HomeRowEntry.ForCatalog(item);
            }
        }
    }
}
