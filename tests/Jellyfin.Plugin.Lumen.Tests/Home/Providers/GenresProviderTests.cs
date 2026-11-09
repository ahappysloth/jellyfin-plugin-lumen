using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home.Providers;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Querying;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class GenresProviderTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly User _user = TestData.User();
    private readonly List<InternalItemsQuery> _queries = [];
    private readonly Dictionary<Guid, int> _counts = [];
    private readonly Dictionary<Guid, BaseItem> _titleBackdrops = [];
    private readonly Dictionary<Guid, BaseItem> _anyBackdrops = [];
    private readonly List<Genre> _genres = [];

    public GenresProviderTests()
    {
        _library.GetGenres(Arg.Do<InternalItemsQuery>(_queries.Add))
            .Returns(_ => new QueryResult<(BaseItem, ItemCounts)>(_genres.Select(g => ((BaseItem)g, new ItemCounts())).ToList()));
        _library.GetCount(Arg.Do<InternalItemsQuery>(_queries.Add)).Returns(ci => _counts.GetValueOrDefault(ci.Arg<InternalItemsQuery>().GenreIds[0]));
        _library.GetItemList(Arg.Do<InternalItemsQuery>(_queries.Add)).Returns(ci =>
        {
            var q = ci.Arg<InternalItemsQuery>();
            var source = q.IncludeItemTypes.Length == 0 ? _anyBackdrops : _titleBackdrops;
            return source.TryGetValue(q.GenreIds[0], out var item) ? new[] { item } : Array.Empty<BaseItem>();
        });
    }

    [Fact]
    public async Task OneRow_OfGenresWithTitles_Alphabetical_SkippingEmpty()
    {
        var drama = WithGenre("Drama", 5);
        var action = WithGenre("Action", 2);
        var comedy = WithGenre("comedy", 2);
        WithGenre("Empty", 0);
        var def = TestData.Section(SectionTypes.Genres);

        var rows = await new GenresProvider(_library).GetRowsAsync(TestData.Context(_user), def, CancellationToken.None);

        var row = Assert.Single(rows);
        Assert.Equal(SectionTypes.Genres, row.Type);
        Assert.Equal("Popular Genres", row.Title);
        Assert.Equal([action, comedy, drama], row.Items);
        Assert.All(_queries, q => Assert.Same(_user, q.User));
        var count = _queries.First(q => q.Limit is null);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Series], count.IncludeItemTypes);
        Assert.True(count.Recursive);
    }

    [Fact]
    public async Task KeepsTheTwelveMostPopularGenres_ShownAlphabetically()
    {
        // G14 is the most popular and G00 the least, so popularity order is the reverse of alphabetical.
        for (var i = 0; i < 15; i++)
        {
            WithGenre($"G{14 - i:D2}", 100 - i);
        }

        var rows = await new GenresProvider(_library).GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Genres), CancellationToken.None);

        var items = Assert.Single(rows).Items;
        Assert.Equal(GenresProvider.MaxGenres, items.Count);
        Assert.Equal("G03", items[0].Name);
        Assert.Equal("G14", items[^1].Name);
    }

    [Fact]
    public async Task BackdropSource_IsTopRatedTitle_ElseAnyItem_ElseNone()
    {
        var withTitle = WithGenre("A", 3);
        var withOther = WithGenre("B", 2);
        var bare = WithGenre("C", 1);
        var topTitle = TestData.Movie("top").WithImages(ImageType.Backdrop);
        var other = TestData.Movie("other").WithImages(ImageType.Backdrop);
        _titleBackdrops[withTitle.Id] = topTitle;
        _anyBackdrops[withTitle.Id] = other;
        _anyBackdrops[withOther.Id] = other;

        var rows = await new GenresProvider(_library).GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Genres), CancellationToken.None);

        var sources = Assert.Single(rows).BackdropSources!;
        Assert.Same(topTitle, sources[withTitle.Id]);
        Assert.Same(other, sources[withOther.Id]);
        Assert.False(sources.ContainsKey(bare.Id));
        var representative = _queries.First(q => q.Limit == 1 && q.GenreIds[0] == withTitle.Id);
        Assert.Equal([ImageType.Backdrop], representative.ImageTypes);
        Assert.Equal((ItemSortBy.CommunityRating, Jellyfin.Database.Implementations.Enums.SortOrder.Descending), representative.OrderBy[0]);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Series], representative.IncludeItemTypes);
    }

    [Fact]
    public async Task NoGenres_NoRows()
    {
        Assert.Empty(await new GenresProvider(_library).GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Genres), CancellationToken.None));
    }

    [Fact]
    public async Task OnlyEmptyGenres_NoRows()
    {
        WithGenre("Empty", 0);

        Assert.Empty(await new GenresProvider(_library).GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Genres), CancellationToken.None));
    }

    [Fact]
    public async Task LibraryParam_ScopesQueries_AndHiddenLibraryYieldsNothing()
    {
        WithGenre("Drama", 1);
        var visible = Guid.NewGuid();
        var hidden = Guid.NewGuid();
        _library.GetItemById<Folder>(visible, _user).Returns(new Folder { Id = visible });
        _library.GetItemById<Folder>(hidden, _user).Returns((Folder?)null);
        var provider = new GenresProvider(_library);

        var rows = await provider.GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Genres, ("libraryId", visible.ToString("N"))), CancellationToken.None);
        Assert.Single(rows);
        Assert.All(_queries, q => Assert.Equal(visible, q.ParentId));

        _queries.Clear();
        Assert.Empty(await provider.GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Genres, ("libraryId", hidden.ToString("N"))), CancellationToken.None));
        Assert.Empty(_queries);
    }

    private Genre WithGenre(string name, int count)
    {
        var genre = new Genre { Id = Guid.NewGuid(), Name = name };
        _counts[genre.Id] = count;
        _genres.Add(genre);
        return genre;
    }
}
