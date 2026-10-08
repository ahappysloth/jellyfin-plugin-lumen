using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.TV;
using MediaBrowser.Model.Querying;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>The next unwatched episode of each show in progress (resumable episodes are in Continue Watching).</summary>
public sealed class NextUpProvider : IHomeSectionProvider
{
    private readonly ITVSeriesManager _seriesManager;

    public NextUpProvider(ITVSeriesManager seriesManager)
    {
        _seriesManager = seriesManager;
    }

    public string Type => SectionTypes.NextUp;

    public string DisplayName => "Next Up";

    public IReadOnlyList<SectionParameter> Parameters => [];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var result = _seriesManager.GetNextUp(
            new NextUpQuery
            {
                User = context.User,
                Limit = context.ItemLimit,
                EnableResumable = false,
                EnableRewatching = false,
                EnableTotalRecordCount = false,
            },
            QueryOptions.Full());

        return Task.FromResult(HomeRow.Single(definition, DisplayName, result.Items));
    }
}
