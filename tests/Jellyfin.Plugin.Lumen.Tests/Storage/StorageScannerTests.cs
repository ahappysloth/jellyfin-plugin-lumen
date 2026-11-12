using Jellyfin.Plugin.Lumen.Storage;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.MediaInfo;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Storage;

/// <summary>The real <see cref="StorageScanner"/> over a fake library manager.</summary>
public class StorageScannerTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly List<InternalItemsQuery> _idQueries = [];

    [Fact]
    public void ALargeLibrary_IsReadInPagesOf500()
    {
        var tv = Library("Shows", "/tv");
        const int seriesCount = 600, perSeries = 100; // 60,000 episodes
        var all = new List<BaseItem>();
        for (var s = 0; s < seriesCount; s++)
        {
            var series = TestData.Series($"Show {s}");
            for (var e = 0; e < perSeries; e++)
            {
                var episode = TestData.Episode(series, 1, e + 1);
                episode.Path = $"/tv/Show {s}/S01E{e + 1:000} some long-ish release name 1080p.mkv";
                episode.Size = 1_500_000_000;
                episode.Width = 1920;
                episode.Height = 1080;
                all.Add(episode);
            }
        }

        var pageSizes = Items(all);
        _library.GetCollectionFolders(Arg.Any<BaseItem>(), Arg.Any<IEnumerable<Folder>>()).Returns([tv]);

        var report = Scanner().Scan(CancellationToken.None);

        Assert.Equal(60_000, report.Totals.Files);
        Assert.Equal(60_000L * 1_500_000_000, report.Totals.Size);
        Assert.All(pageSizes, n => Assert.True(n <= StorageScanner.BatchSize));
        Assert.Equal(120, pageSizes.Count);
        Assert.Equal(StorageAggregator.TopCount, report.BiggestSeries.Count);
        Assert.Equal(report.Totals.Size, report.Libraries.Sum(l => l.Storage.Size));
    }

    [Fact]
    public void AsksOnlyForTheLibraries_AndForNothingAnotherItemOwns()
    {
        var movies = Library("Movies", "/movies");
        var shows = Library("Shows", "/tv");
        Items([]);

        Scanner().Scan(CancellationToken.None);

        // Items carry the folder of the library path they're in as their top parent, not the library's own id.
        var query = Assert.Single(_idQueries);
        Assert.Equal([.. movies.PhysicalFolderIds, movies.Id, .. shows.PhysicalFolderIds, shows.Id], query.TopParentIds);
        Assert.Equal(2, movies.PhysicalFolderIds.Length);
        Assert.False(query.HasOwnerId);
        Assert.False(query.IsVirtualItem);
        Assert.False(query.IncludeExtras);
    }

    [Fact]
    public void WithoutLibraries_NothingIsAskedFor()
    {
        _library.GetVirtualFolders().Returns([]);

        var report = Scanner().Scan(CancellationToken.None);

        Assert.Empty(_idQueries);
        Assert.Equal(0, report.Totals.Files);
    }

    [Fact]
    public void AVideoOutsideEveryLibrary_IsLeftOut_SoTheLibrariesAddUpToTheTotal()
    {
        var movies = Library("Movies", "/movies");
        var inLibrary = new FakeMovie("In a library", Source("/movies/a.mkv", 10));
        var outside = new FakeMovie("Outside", Source("/elsewhere/video.mp4", 1000));
        Items([inLibrary, outside]);
        _library.GetCollectionFolders(inLibrary, Arg.Any<IEnumerable<Folder>>()).Returns([movies]);
        _library.GetCollectionFolders(outside, Arg.Any<IEnumerable<Folder>>()).Returns([]);

        var report = Scanner().Scan(CancellationToken.None);

        Assert.Equal(10, report.Totals.Size);
        Assert.Equal(10, report.Libraries.Sum(l => l.Storage.Size));

        // Its media sources weren't even read.
        Assert.Equal(0, outside.SourceReads);
    }

    [Fact]
    public void AChannelsVideo_IsSkipped_BeforeItsMediaSourcesAreRead()
    {
        var movies = Library("Movies", "/movies");
        var channel = new FakeMovie("A channel's video", Source("/config/data/channels/x/video.mp4", 1000)) { ChannelId = Guid.NewGuid() };
        Items([channel]);
        _library.GetCollectionFolders(Arg.Any<BaseItem>(), Arg.Any<IEnumerable<Folder>>()).Returns([movies]);

        var report = Scanner().Scan(CancellationToken.None);

        Assert.Equal(0, report.Totals.Files);
        Assert.Equal(0, channel.SourceReads);
    }

    [Fact]
    public void AStackedMovie_AddsItsFurtherParts_ToTheSameTitle()
    {
        var movies = Library("Movies", "/movies");
        const string cd2Path = "/movies/Stacked/Stacked - cd2.mkv";
        var movie = new FakeMovie("Stacked", Source("/movies/Stacked/Stacked - cd1.mkv", 972_679))
        {
            AdditionalParts = [cd2Path],
        };
        var cd2 = new FakeVideo(Source(cd2Path, 956_740)) { Name = "Stacked", OwnerId = movie.Id };
        _library.GetNewItemId(cd2Path, typeof(Video)).Returns(cd2.Id);
        _library.GetItemById(cd2.Id).Returns(cd2);
        Items([movie]);
        _library.GetCollectionFolders(Arg.Any<BaseItem>(), Arg.Any<IEnumerable<Folder>>()).Returns([movies]);

        var report = Scanner().Scan(CancellationToken.None);

        Assert.Equal((1_929_419L, 2), (report.Totals.Size, report.Totals.Files));
        var top = Assert.Single(report.BiggestMovies);
        Assert.Equal(("Stacked", 1_929_419L, 2), (top.Name, top.Size, top.Files));
    }

    [Fact]
    public void AVersionMergedInFromAnotherLibrary_CountsInItsOwnLibrary_AndOnceInTheTotal()
    {
        // Jellyfin made the 4K one (in Films 4K) primary; the 720p one stays in its own folder, in Films.
        var films = Library("Films", "/testlib/movies-a");
        var films4K = Library("Films 4K", "/testlib/movies-4k");
        var hd = new FakeMovie("Gamma", Source("/testlib/movies-a/Gamma (2003)/Gamma - 720p.webm", 30_916));
        var uhd = new FakeMovie("Gamma", Source("/testlib/movies-4k/Gamma (2003)/Gamma - 4K.webm", 37_225));
        hd.PrimaryVersionId = uhd.Id;
        hd.SourcesAreOwn();
        uhd.SourcesAreOwn();
        uhd.AddVersion(hd);
        var other = new FakeMovie("Other", Source("/testlib/movies-a/Other (2001)/Other.webm", 1_000));
        other.SourcesAreOwn();
        Items([uhd, hd, other]);
        _library.GetItemById(hd.Id).Returns(hd);
        _library.GetCollectionFolders(uhd, Arg.Any<IEnumerable<Folder>>()).Returns([films4K]);
        _library.GetCollectionFolders(hd, Arg.Any<IEnumerable<Folder>>()).Returns([films]);
        _library.GetCollectionFolders(other, Arg.Any<IEnumerable<Folder>>()).Returns([films]);

        var report = Scanner().Scan(CancellationToken.None);

        var byName = report.Libraries.ToDictionary(l => l.Name, l => (l.Storage.Size, l.Storage.Files));
        Assert.Equal((37_225L, 1), byName["Films 4K"]);
        Assert.Equal((31_916L, 2), byName["Films"]);
        Assert.Equal((69_141L, 3), (report.Totals.Size, report.Totals.Files));
        Assert.Equal(report.Totals.Size, report.Libraries.Sum(l => l.Storage.Size));

        // The title still has both its versions, once.
        var gamma = Assert.Single(report.BiggestMovies, m => m.Name == "Gamma");
        Assert.Equal((uhd.Id, 68_141L, 2), (gamma.Id, gamma.Size, gamma.Files));

        // A source that is the item's own needs no lookup: only the merged version was looked up.
        _library.Received(1).GetItemById(hd.Id);
        _library.DidNotReceive().GetItemById(uhd.Id);
        _library.DidNotReceive().GetItemById(other.Id);
    }

    [Fact]
    public void AVersionMergedInFromOutsideTheLibraries_IsLeftOut()
    {
        var films = Library("Films", "/films");
        var inside = new FakeMovie("Delta", Source("/films/Delta/Delta.mkv", 500));
        var outside = new FakeMovie("Delta", Source("/elsewhere/Delta.mkv", 9_000)) { PrimaryVersionId = inside.Id };
        inside.SourcesAreOwn();
        outside.SourcesAreOwn();
        inside.AddVersion(outside);
        Items([inside]);
        _library.GetItemById(outside.Id).Returns(outside);
        _library.GetCollectionFolders(inside, Arg.Any<IEnumerable<Folder>>()).Returns([films]);
        _library.GetCollectionFolders(outside, Arg.Any<IEnumerable<Folder>>()).Returns([]);

        var report = Scanner().Scan(CancellationToken.None);

        Assert.Equal((500L, 1), (report.Totals.Size, report.Totals.Files));
        Assert.Equal((500L, 1), (report.Libraries.Single().Storage.Size, report.Libraries.Single().Storage.Files));
        Assert.Equal((500L, 1), (report.BiggestMovies.Single().Size, report.BiggestMovies.Single().Files));
    }

    [Fact]
    public void AVersionWhosePrimaryIsOutsideTheLibraries_CountsOnItsOwn()
    {
        // Merged with a copy outside every library, which Jellyfin made primary: the scan never reaches that one.
        var films4K = Library("Films 4K", "/testlib/movies-4k");
        var primary = new FakeMovie("Gamma", Source("/elsewhere/Gamma - 720p.webm", 30_916));
        var uhd = new FakeMovie("Gamma", Source("/testlib/movies-4k/Gamma (2003)/Gamma - 4K.webm", 37_225)) { PrimaryVersionId = primary.Id };
        primary.SourcesAreOwn();
        uhd.SourcesAreOwn();
        uhd.AddVersion(primary);
        Items([uhd]);
        _library.GetItemById(primary.Id).Returns(primary);
        _library.GetCollectionFolders(uhd, Arg.Any<IEnumerable<Folder>>()).Returns([films4K]);
        _library.GetCollectionFolders(primary, Arg.Any<IEnumerable<Folder>>()).Returns([]);

        var report = Scanner().Scan(CancellationToken.None);

        Assert.Equal((37_225L, 1), (report.Totals.Size, report.Totals.Files));
        Assert.Equal((37_225L, 1), (report.Libraries.Single().Storage.Size, report.Libraries.Single().Storage.Files));
        var gamma = Assert.Single(report.BiggestMovies);
        Assert.Equal((uhd.Id, 37_225L, 1), (gamma.Id, gamma.Size, gamma.Files));
    }

    private static MediaSourceInfo Source(string path, long size) => new()
    {
        Id = Guid.NewGuid().ToString("N"),
        Path = path,
        Protocol = MediaProtocol.File,
        Size = size,
        MediaStreams = [new MediaStream { Type = MediaStreamType.Video, Index = 0, Codec = "h264", Width = 1920, Height = 1080 }],
    };

    private CollectionFolder Library(string name, string path)
    {
        // Two paths, as a library can have: each a folder of its own.
        var folder = new CollectionFolder { Id = Guid.NewGuid(), Name = name, Path = path, PhysicalFolderIds = [Guid.NewGuid(), Guid.NewGuid()] };
        var existing = _library.GetVirtualFolders() ?? [];
        _library.GetVirtualFolders().Returns([.. existing, new VirtualFolderInfo { ItemId = folder.Id.ToString("N"), Name = name }]);
        _library.GetItemById(folder.Id).Returns(folder);
        return folder;
    }

    /// <summary>The items the scan finds; returns the sizes of the pages it loads them in.</summary>
    private List<int> Items(IReadOnlyList<BaseItem> items)
    {
        var byId = items.ToDictionary(i => i.Id);
        _library.GetItemIds(Arg.Any<InternalItemsQuery>()).Returns(ci =>
        {
            _idQueries.Add(ci.Arg<InternalItemsQuery>());
            return items.Select(i => i.Id).ToList();
        });
        var pageSizes = new List<int>();
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(ci =>
        {
            var query = ci.Arg<InternalItemsQuery>();
            pageSizes.Add(query.ItemIds.Length);
            return query.ItemIds.Select(id => byId[id]).ToList();
        });
        return pageSizes;
    }

    private StorageScanner Scanner() => new(_library, TimeProvider.System, NullLogger<StorageScanner>.Instance);

    /// <summary>A movie whose media sources are given, counting how often they're read.</summary>
    private sealed class FakeMovie : Movie
    {
        private MediaSourceInfo[] _sources;

        public FakeMovie(string name, params MediaSourceInfo[] sources)
        {
            Id = Guid.NewGuid();
            Name = name;
            Path = sources.FirstOrDefault()?.Path;
            _sources = sources;
        }

        public int SourceReads { get; private set; }

        /// <summary>Gives its sources its own id, as Jellyfin does: a media source's id is its version's item id.</summary>
        public void SourcesAreOwn()
        {
            foreach (var source in _sources)
            {
                source.Id = Id.ToString("N");
            }
        }

        /// <summary>Merges another movie in as a version: its media sources become this one's too, as the primary's.</summary>
        public void AddVersion(FakeMovie version) => _sources = [.. _sources, .. version._sources];

        public override IReadOnlyList<MediaSourceInfo> GetMediaSources(bool enablePathSubstitution)
        {
            SourceReads++;
            return _sources;
        }
    }

    private sealed class FakeVideo : Video
    {
        private readonly MediaSourceInfo[] _sources;

        public FakeVideo(params MediaSourceInfo[] sources)
        {
            Id = Guid.NewGuid();
            Path = sources.FirstOrDefault()?.Path;
            _sources = sources;
        }

        public override IReadOnlyList<MediaSourceInfo> GetMediaSources(bool enablePathSubstitution) => _sources;
    }
}
