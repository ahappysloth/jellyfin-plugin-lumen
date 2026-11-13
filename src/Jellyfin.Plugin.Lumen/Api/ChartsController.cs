using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Trakt;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>
/// The Top charts page's data (Trakt design note, 2026-11-12). 404 while Lumen is off or no Trakt key is saved (the page
/// doesn't exist then); 503 when Trakt can't give the chart and Lumen has no copy of it.
/// </summary>
[ApiController]
[Route("Lumen/Charts")]
[Authorize]
public sealed class ChartsController : ControllerBase
{
    private readonly ChartService _charts;
    private readonly IHomeDtoMapper _mapper;
    private readonly IUserManager _users;
    private readonly ILumenConfigReader _config;
    private readonly ILogger<ChartsController> _logger;

    public ChartsController(ChartService charts, IHomeDtoMapper mapper, IUserManager users, ILumenConfigReader config, ILogger<ChartsController> logger)
    {
        _charts = charts;
        _mapper = mapper;
        _users = users;
        _config = config;
        _logger = logger;
    }

    /// <summary>A page of Trakt's most watched movies or shows of a period: <c>movies</c> or <c>shows</c>, and
    /// <c>weekly</c>, <c>monthly</c>, <c>yearly</c> or <c>all</c>.</summary>
    [HttpGet("{type}/{period}")]
    [CompressOverHttps]
    public async Task<ActionResult<ChartPageDto>> GetChart(
        [FromRoute] string type,
        [FromRoute] string period,
        [FromQuery] int startIndex = 0,
        [FromQuery] int limit = ChartService.DefaultPageSize,
        CancellationToken cancellationToken = default)
    {
        var user = User.GetJellyfinUserId(_logger) is { } id ? _users.GetUserById(id) : null;
        if (user is null)
        {
            return Unauthorized();
        }

        if (!_config.Current.Enabled || !_charts.Enabled)
        {
            return NotFound();
        }

        if (ParseKind(type) is not { } kind || ParsePeriod(period) is not { } span)
        {
            return BadRequest(new ValidationErrorsDto(["The chart is movies or shows, and weekly, monthly, yearly or all."]));
        }

        var page = await _charts.GetPageAsync(user, kind, span, startIndex, limit, cancellationToken).ConfigureAwait(false);
        if (page is null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new ValidationErrorsDto(["Trakt isn't answering."]));
        }

        // The library items in one batch, as the home rows map theirs.
        var items = page.Entries.Select(e => e.Item).OfType<MediaBrowser.Controller.Entities.BaseItem>().ToList();
        var mapped = new Dictionary<Guid, BaseItemDto>();
        foreach (var dto in items.Count == 0 ? [] : _mapper.MapCards(items, user))
        {
            mapped.TryAdd(dto.Id, dto);
        }

        var entries = page.Entries
            .Select(e => e.Item is null
                ? new ChartEntryDto(e.Rank, null, e.Catalog)
                : mapped.TryGetValue(e.Item.Id, out var dto) ? new ChartEntryDto(e.Rank, dto, null) : null)
            .OfType<ChartEntryDto>()
            .ToList();
        return new ChartPageDto(entries, page.TotalCount, page.StartIndex, page.Missing);
    }

    internal static TraktListKind? ParseKind(string? type) => type?.ToLowerInvariant() switch
    {
        "movies" => TraktListKind.Movies,
        "shows" => TraktListKind.Shows,
        _ => null,
    };

    internal static TraktPeriod? ParsePeriod(string? period) => period?.ToLowerInvariant() switch
    {
        "weekly" => TraktPeriod.Weekly,
        "monthly" => TraktPeriod.Monthly,
        "yearly" => TraktPeriod.Yearly,
        "all" => TraktPeriod.All,
        _ => null,
    };
}

/// <summary>
/// A page of a chart. <c>TotalCount</c> is how many titles the chart has for this user (its pages' end); <c>Missing</c>,
/// how many of this page's titles Seerr couldn't describe this time (the page says so, and offers to try again).
/// </summary>
public sealed record ChartPageDto(IReadOnlyList<ChartEntryDto> Entries, int TotalCount, int StartIndex, int Missing = 0);

/// <summary>A chart's title: its Trakt rank, and a library card (<c>Item</c>) or a catalog card (<c>Catalog</c>).</summary>
public sealed record ChartEntryDto(int Rank, BaseItemDto? Item, CatalogItemDto? Catalog);
