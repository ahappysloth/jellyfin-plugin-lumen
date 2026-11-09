using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// The user's recent requests, newest first: declined requests skipped, one card per title. Seerr's request list has
/// no titles or art, so each title's details are fetched (cached server-wide, a few at a time); the state comes from
/// the request's media, which is fresh.
/// </summary>
public sealed class MyRequestsProvider : CatalogSectionProvider
{
    public const int MaxConcurrentDetails = 6;

    /// <summary>How long title lookups may take before the row is returned with the titles resolved so far.</summary>
    private static readonly TimeSpan DetailsBudget = TimeSpan.FromSeconds(4);

    public MyRequestsProvider(CatalogRowAccess access, ISeerrClient seerr, CatalogMapper mapper, ILogger<MyRequestsProvider> logger)
        : base(access, seerr, mapper, logger)
    {
    }

    public override string Type => SectionTypes.MyRequests;

    public override string DisplayName => "My Requests";

    public override string Description => "What the viewer has requested through Seerr and how each request is going; hidden when there are none.";

    protected override async Task<IReadOnlyList<CatalogItemDto>> GetItemsAsync(SeerrEndpoint endpoint, int seerrUserId, HomeContext context, CancellationToken cancellationToken)
    {
        var requests = await Seerr.GetUserRequestsAsync(endpoint, seerrUserId, cancellationToken).ConfigureAwait(false);
        var wanted = requests
            .Where(r => r.Status != SeerrRequestStatus.Declined && r.Media is { TmdbId: > 0 })
            .Select(r => (Request: r, MediaType: r.Type ?? r.Media!.MediaType))
            .Where(r => CatalogMediaType.IsValid(r.MediaType))
            .OrderByDescending(r => r.Request.CreatedAt ?? DateTimeOffset.MinValue)
            .DistinctBy(r => (r.MediaType, r.Request.Media!.TmdbId))
            .Take(context.ItemLimit)
            .ToList();

        // Not disposed: lookups still running after the budget below keep using it (it holds no OS handle).
        var gate = new SemaphoreSlim(MaxConcurrentDetails);
        var lookups = wanted
            .Select(r => ResolveAsync(endpoint, seerrUserId, r.MediaType!, r.Request.Media!, context.User, gate, cancellationToken))
            .ToList();
        var all = Task.WhenAll(lookups);

        // Return what has resolved within the budget rather than lose the whole row to the provider timeout on a cold
        // cache; the rest finish in the background and warm the shared cache for the next home load.
        await Task.WhenAny(all, Task.Delay(DetailsBudget, cancellationToken)).ConfigureAwait(false);
        _ = all.ContinueWith(t => _ = t.Exception, CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
        return lookups.Where(t => t.IsCompletedSuccessfully).Select(t => t.Result).OfType<CatalogItemDto>().ToList();
    }

    /// <summary>The card for one requested title, or null if Seerr couldn't give its details.</summary>
    private async Task<CatalogItemDto?> ResolveAsync(
        SeerrEndpoint endpoint, int seerrUserId, string mediaType, SeerrRequestMedia media, User user, SemaphoreSlim gate, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        SeerrTitle title;
        try
        {
            title = await Seerr.GetTitleSummaryAsync(endpoint, seerrUserId, mediaType, media.TmdbId, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException)
        {
            return null;
        }
        finally
        {
            gate.Release();
        }

        // Card fields from the (cached) details; the state and Jellyfin item from the request, which is fresh.
        var card = new SeerrMedia
        {
            MediaType = mediaType,
            Id = media.TmdbId,
            Title = title.Title,
            Name = title.Name,
            ReleaseDate = title.ReleaseDate,
            FirstAirDate = title.FirstAirDate,
            Overview = title.Overview,
            PosterPath = title.PosterPath,
            BackdropPath = title.BackdropPath,
            VoteAverage = title.VoteAverage,
            GenreIds = title.GenreIds,
            MediaInfo = new SeerrMediaInfo { Status = media.Status, JellyfinMediaId = media.JellyfinMediaId },
        };
        return Mapper.ToItem(mediaType, card, user, CatalogMapper.TitleGenreNames(title));
    }
}
