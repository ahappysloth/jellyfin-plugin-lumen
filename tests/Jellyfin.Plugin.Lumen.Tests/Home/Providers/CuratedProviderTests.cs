using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class CuratedProviderTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly ILinkedItemsReader _reader = Substitute.For<ILinkedItemsReader>();
    private readonly User _user = TestData.User();

    [Theory]
    [InlineData(false, false, false, true)]
    [InlineData(true, true, false, true)]
    [InlineData(true, false, false, false)]
    [InlineData(false, false, true, false)]
    public void RequiresExactlyOneSource(bool collection, bool playlist, bool tag, bool expectError)
    {
        var ps = new List<(string, string)>();
        if (collection)
        {
            ps.Add(("collectionId", Guid.NewGuid().ToString()));
        }

        if (playlist)
        {
            ps.Add(("playlistId", Guid.NewGuid().ToString()));
        }

        if (tag)
        {
            ps.Add(("tag", "holiday"));
        }

        var errors = Create().Validate(TestData.Section(SectionTypes.Curated, ps.ToArray()));

        Assert.Equal(expectError, errors.Count > 0);
    }

    [Fact]
    public async Task Collection_UsesReader_AndCollectionNameAsDefaultTitle()
    {
        var id = Guid.NewGuid();
        var movie = TestData.Movie("m");
        _reader.GetCollection(id, _user).Returns(new CuratedSource("Holiday Movies", [movie]));

        var rows = await Create().GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Curated, ("collectionId", id.ToString())), CancellationToken.None);

        var row = Assert.Single(rows);
        Assert.Equal("Holiday Movies", row.Title);
        Assert.Equal([movie], row.Items);
    }

    [Fact]
    public async Task MissingOrHiddenCollection_NoRows()
    {
        _reader.GetCollection(Arg.Any<Guid>(), _user).Returns((CuratedSource?)null);

        var rows = await Create().GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Curated, ("collectionId", Guid.NewGuid().ToString())), CancellationToken.None);

        Assert.Empty(rows);
    }

    [Fact]
    public async Task Tag_QueriesByTag_SortedByName()
    {
        InternalItemsQuery? q = null;
        _library.GetItemList(Arg.Do<InternalItemsQuery>(x => q = x)).Returns(new BaseItem[] { TestData.Movie("t") });

        var rows = await Create().GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Curated, ("tag", "holiday")), CancellationToken.None);

        Assert.Equal("holiday", Assert.Single(rows).Title);
        Assert.Equal(["holiday"], q!.Tags);
        Assert.Same(_user, q.User);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Series], q.IncludeItemTypes);
        Assert.Equal((ItemSortBy.SortName, SortOrder.Ascending), Assert.Single(q.OrderBy));
    }

    [Fact]
    public async Task LimitsItems()
    {
        var id = Guid.NewGuid();
        _reader.GetPlaylist(id, _user).Returns(new CuratedSource("P", Enumerable.Range(0, 50).Select(i => (BaseItem)TestData.Movie($"m{i}")).ToList()));

        var rows = await Create().GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Curated, ("playlistId", id.ToString())), CancellationToken.None);

        Assert.Equal(20, Assert.Single(rows).Items.Count);
    }

    private CuratedProvider Create() => new(_library, _reader);
}
