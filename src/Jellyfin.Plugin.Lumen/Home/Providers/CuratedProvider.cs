using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>An admin-chosen collection, playlist, or tag, in source order (tag: by name).</summary>
public sealed class CuratedProvider : IHomeSectionProvider
{
    private static readonly string[] SourceParameters = ["collectionId", "playlistId", "tag"];

    private readonly ILibraryManager _libraryManager;
    private readonly ILinkedItemsReader _reader;

    public CuratedProvider(ILibraryManager libraryManager, ILinkedItemsReader reader)
    {
        _libraryManager = libraryManager;
        _reader = reader;
    }

    public string Type => SectionTypes.Curated;

    public string DisplayName => "Curated row";

    public IReadOnlyList<SectionParameter> Parameters { get; } =
    [
        new SectionParameter("collectionId", "Collection", SectionParameterKind.Collection),
        new SectionParameter("playlistId", "Playlist", SectionParameterKind.Playlist),
        new SectionParameter("tag", "Tag", SectionParameterKind.Text),
    ];

    public IReadOnlyList<string> Validate(SectionDefinition definition)
    {
        var sources = SourceParameters.Count(p => definition.GetParam(p) is not null);
        return sources == 1 ? [] : ["Choose exactly one source: a collection, a playlist, or a tag."];
    }

    public Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        CuratedSource? source = null;
        if (definition.GetGuidParam("collectionId") is { } collectionId)
        {
            source = _reader.GetCollection(collectionId, context.User);
        }
        else if (definition.GetGuidParam("playlistId") is { } playlistId)
        {
            source = _reader.GetPlaylist(playlistId, context.User);
        }
        else if (definition.GetParam("tag") is { } tag)
        {
            source = new CuratedSource(tag, _libraryManager.GetItemList(new InternalItemsQuery(context.User)
            {
                Tags = [tag],
                IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Series],
                Recursive = true,
                IsVirtualItem = false,
                OrderBy = [(ItemSortBy.SortName, SortOrder.Ascending)],
                Limit = context.ItemLimit,
                DtoOptions = QueryOptions.Full(),
            }));
        }

        return Task.FromResult(source is null
            ? (IReadOnlyList<HomeRow>)[]
            : HomeRow.Single(definition, source.Name, source.Items.Take(context.ItemLimit).ToList()));
    }
}
