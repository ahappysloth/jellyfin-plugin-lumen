using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// Personalized rows. Movies use Jellyfin's built-in recommendations; shows use similar-items for shows in the user's
/// recent history. Movie and show rows alternate, up to maxRows. Played items are removed.
/// </summary>
public sealed class BecauseYouWatchedProvider : IHomeSectionProvider
{
    private readonly ISimilarItemsManager _similarItems;
    private readonly ILibraryManager _libraryManager;
    private readonly IUserDataManager _userDataManager;

    public BecauseYouWatchedProvider(ISimilarItemsManager similarItems, ILibraryManager libraryManager, IUserDataManager userDataManager)
    {
        _similarItems = similarItems;
        _libraryManager = libraryManager;
        _userDataManager = userDataManager;
    }

    public string Type => SectionTypes.BecauseYouWatched;

    public string DisplayName => "Because You Watched";

    public IReadOnlyList<SectionParameter> Parameters { get; } =
        [new SectionParameter("maxRows", "Maximum rows", SectionParameterKind.Integer, DefaultValue: "2", Min: 1, Max: 5)];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public async Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var maxRows = definition.GetIntParam("maxRows", 2);

        var recommendations = await _similarItems.GetMovieRecommendationsAsync(
            context.User, Guid.Empty, maxRows, context.ItemLimit, QueryOptions.Full(), cancellationToken);
        var movieRows = recommendations
            .Select(r => (Title: TitleFor(r), Items: Unplayed(r.Items, context)))
            .Where(r => r.Items.Count > 0)
            .ToList();

        var history = await context.GetWatchHistoryAsync();
        var seriesRows = new List<(string Title, List<BaseItem> Items)>();
        foreach (var seriesId in history.Entries.Where(e => e.SeriesId is not null).Select(e => e.SeriesId!.Value).Distinct().Take(maxRows))
        {
            var series = _libraryManager.GetItemById<Series>(seriesId, context.User);
            if (series is null)
            {
                continue;
            }

            var similar = await _similarItems.GetSimilarItemsAsync(
                series, [], context.User, QueryOptions.Full(), context.ItemLimit * 2, _libraryManager.GetLibraryOptions(series), cancellationToken);
            var items = Unplayed(similar, context);
            if (items.Count > 0)
            {
                seriesRows.Add(($"Because you watched {series.Name}", items));
            }
        }

        return Interleave(movieRows, seriesRows)
            .Take(maxRows)
            .Select((row, index) => new HomeRow(HomeRow.RowId(definition, index), Type, row.Title, row.Items))
            .ToList();
    }

    internal static string TitleFor(SimilarItemsRecommendation recommendation) => recommendation.RecommendationType switch
    {
        RecommendationType.HasDirectorFromRecentlyPlayed or RecommendationType.HasLikedDirector => $"Directed by {recommendation.BaselineItemName}",
        RecommendationType.HasActorFromRecentlyPlayed or RecommendationType.HasLikedActor => $"Starring {recommendation.BaselineItemName}",
        _ => $"Because you watched {recommendation.BaselineItemName}",
    };

    internal static IEnumerable<T> Interleave<T>(IReadOnlyList<T> first, IReadOnlyList<T> second)
    {
        for (var i = 0; i < Math.Max(first.Count, second.Count); i++)
        {
            if (i < first.Count)
            {
                yield return first[i];
            }

            if (i < second.Count)
            {
                yield return second[i];
            }
        }
    }

    private List<BaseItem> Unplayed(IReadOnlyList<BaseItem> items, HomeContext context)
    {
        if (items.Count == 0)
        {
            return [];
        }

        var userData = _userDataManager.GetUserDataBatch(items, context.User);
        return items.Where(i => !(userData.TryGetValue(i.Id, out var data) && data.Played)).Take(context.ItemLimit).ToList();
    }
}
