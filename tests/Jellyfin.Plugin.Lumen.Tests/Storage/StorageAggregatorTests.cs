using Jellyfin.Plugin.Lumen.Storage;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.MediaInfo;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Storage;

public class StorageAggregatorTests
{
    private const long Gb = 1_000_000_000;

    private static readonly Guid Movies = Guid.NewGuid();
    private static readonly Guid Shows = Guid.NewGuid();

    [Fact]
    public void AddsUpEachLibrary_ByCodecAndResolution()
    {
        var aggregator = Aggregator();
        aggregator.Add(TestData.Movie("A"), [Source("/m/a.mkv", 10 * Gb, "h264", 1920, 1080)], [Movies]);
        aggregator.Add(TestData.Movie("B"), [Source("/m/b.mkv", 20 * Gb, "hevc", 3840, 2160)], [Movies]);
        var series = TestData.Series("Show");
        aggregator.Add(TestData.Episode(series, 1, 1), [Source("/tv/e1.mkv", 2 * Gb, "av1", 1280, 720)], [Shows]);
        aggregator.Add(TestData.Episode(series, 1, 2), [Source("/tv/e2.mkv", 1 * Gb, "mpeg2video", 720, 576)], [Shows]);

        var report = aggregator.Build(TestData.Now, 1.5);

        Assert.Equal(33 * Gb, report.Totals.Size);
        Assert.Equal(4, report.Totals.Files);
        Assert.Equal(
            [("H264", 10 * Gb, 1), ("HEVC", 20 * Gb, 1), ("AV1", 2 * Gb, 1), ("Other", 1 * Gb, 1), ("Unknown", 0L, 0)],
            report.Totals.Codecs.Select(b => (b.Key, b.Size, b.Files)));
        Assert.Equal(
            [("SD", 1 * Gb, 1), ("720p", 2 * Gb, 1), ("1080p", 10 * Gb, 1), ("4K", 20 * Gb, 1), ("Unknown", 0L, 0)],
            report.Totals.Resolutions.Select(b => (b.Key, b.Size, b.Files)));

        Assert.Equal(["Movies", "Shows"], report.Libraries.Select(l => l.Name));
        var movies = report.Libraries[0].Storage;
        Assert.Equal((30 * Gb, 2), (movies.Size, movies.Files));
        Assert.Equal(10 * Gb, movies.Codecs.Single(b => b.Key == "H264").Size);
        Assert.Equal(0, movies.Codecs.Single(b => b.Key == "AV1").Files);
        var shows = report.Libraries[1].Storage;
        Assert.Equal((3 * Gb, 2), (shows.Size, shows.Files));
        Assert.Equal(TestData.Now, report.ComputedAt);
    }

    [Fact]
    public void TheReEncodePool_IsH264At1080pAndAbove()
    {
        var aggregator = Aggregator();
        aggregator.Add(TestData.Movie("1080"), [Source("/m/1.mkv", 8 * Gb, "h264", 1920, 1080)], [Movies]);
        aggregator.Add(TestData.Movie("4K"), [Source("/m/2.mkv", 30 * Gb, "h264", 3840, 2160)], [Movies]);
        aggregator.Add(TestData.Movie("720"), [Source("/m/3.mkv", 4 * Gb, "h264", 1280, 720)], [Movies]);
        aggregator.Add(TestData.Movie("HEVC"), [Source("/m/4.mkv", 9 * Gb, "hevc", 1920, 1080)], [Movies]);

        var pool = aggregator.Build(TestData.Now, 0).Totals.H264AtLeast1080p;

        Assert.Equal((38 * Gb, 2), (pool.Size, pool.Files));
    }

    [Fact]
    public void CountsEveryVersionOfAMovieOnce()
    {
        var aggregator = Aggregator();
        var movie = TestData.Movie("Two cuts");
        IReadOnlyList<MediaSourceInfo> versions =
        [
            Source("/m/cut - 1080p.mkv", 12 * Gb, "h264", 1920, 1080),
            Source("/m/cut - 2160p.mkv", 40 * Gb, "hevc", 3840, 1600, Hdr10()),
        ];
        aggregator.Add(movie, versions, [Movies]);

        // The same item again (a second query page, an overlapping library) and its alternate version as an item of
        // its own (its primary's sources already include it) add nothing.
        aggregator.Add(movie, versions, [Movies]);
        var alternate = new Movie { Id = Guid.NewGuid(), Name = "Two cuts", PrimaryVersionId = movie.Id };
        aggregator.Add(alternate, [versions[1]], [Movies]);

        var report = aggregator.Build(TestData.Now, 0);

        Assert.Equal((52 * Gb, 2), (report.Totals.Size, report.Totals.Files));
        var top = Assert.Single(report.BiggestMovies);
        Assert.Equal((52 * Gb, 2), (top.Size, top.Files));

        // The largest version describes it; a 3840×1600 crop is still 4K.
        Assert.Equal(("HEVC", "hevc", "4K", "HDR10"), (top.Codec, top.CodecName, top.Resolution, top.Hdr));
        Assert.Equal((3840, 1600), (top.Width, top.Height));
    }

    [Fact]
    public void AFileTwoItemsShare_IsCountedOnce()
    {
        var aggregator = Aggregator();
        aggregator.Add(TestData.Movie("A"), [Source("/m/same.mkv", 5 * Gb, "h264", 1920, 1080)], [Movies]);
        aggregator.Add(TestData.Movie("B"), [Source("/m/same.mkv", 5 * Gb, "h264", 1920, 1080)], [Movies]);

        Assert.Equal((5 * Gb, 1), (aggregator.Build(TestData.Now, 0).Totals.Size, aggregator.Build(TestData.Now, 0).Totals.Files));
    }

    [Fact]
    public void AnItemInTwoLibraries_CountsInEach_ButOnceInTheTotal()
    {
        var aggregator = Aggregator();
        aggregator.Add(TestData.Movie("A"), [Source("/m/a.mkv", 5 * Gb, "h264", 1920, 1080)], [Movies, Shows]);

        var report = aggregator.Build(TestData.Now, 0);

        Assert.Equal(5 * Gb, report.Totals.Size);
        Assert.All(report.Libraries, l => Assert.Equal(5 * Gb, l.Storage.Size));
    }

    [Fact]
    public void StrmAndRemoteFiles_AreCountedWithAnUnknownSize_NotAsZero()
    {
        var aggregator = new StorageAggregator(_ => null);
        aggregator.AddLibrary(Movies, "Movies", "movies");
        var strm = Source("https://cdn.example/film.mp4", null, "h264", 1920, 1080);
        strm.Protocol = MediaProtocol.Http;
        strm.IsRemote = true;
        aggregator.Add(TestData.Movie("Streamed"), [strm], [Movies]);
        aggregator.Add(TestData.Movie("Local"), [Source("/m/local.mkv", 3 * Gb, "h264", 1920, 1080)], [Movies]);

        var report = aggregator.Build(TestData.Now, 0);

        Assert.Equal((3 * Gb, 2, 1), (report.Totals.Size, report.Totals.Files, report.Totals.UnknownSizeFiles));
        var h264 = report.Totals.Codecs.Single(b => b.Key == "H264");
        Assert.Equal((3 * Gb, 2, 1), (h264.Size, h264.Files, h264.UnknownSizeFiles));

        // A title of unknown size isn't one of the biggest.
        Assert.Equal(["Local"], report.BiggestMovies.Select(m => m.Name));
    }

    [Fact]
    public void ALocalFileJellyfinHasNoSizeFor_IsSizedFromDisk_AndARemoteOneNeverIs()
    {
        var asked = new List<string>();
        var aggregator = new StorageAggregator(path =>
        {
            asked.Add(path);
            return 7 * Gb;
        });
        aggregator.Add(TestData.Movie("Unsized"), [Source("/m/unsized.mkv", null, "h264", 1920, 1080)], []);
        var remote = Source("https://cdn.example/x.mp4", null, "h264", 1920, 1080);
        remote.Protocol = MediaProtocol.Http;
        aggregator.Add(TestData.Movie("Remote"), [remote], []);

        var totals = aggregator.Build(TestData.Now, 0).Totals;

        Assert.Equal(["/m/unsized.mkv"], asked);
        Assert.Equal((7 * Gb, 1), (totals.Size, totals.UnknownSizeFiles));
    }

    [Fact]
    public void WithoutMediaSources_TheItemItselfIsTheFile()
    {
        var aggregator = Aggregator();
        var movie = TestData.Movie("Unprobed");
        movie.Path = "/m/unprobed.mkv";
        movie.Size = 2 * Gb;
        movie.Width = 1920;
        movie.Height = 800;
        aggregator.Add(movie, [], [Movies]);

        var top = Assert.Single(aggregator.Build(TestData.Now, 0).BiggestMovies);

        Assert.Equal((2 * Gb, "Unknown", "1080p"), (top.Size, top.Codec, top.Resolution));
    }

    [Fact]
    public void TrailersExtrasAndMissingEpisodesAreLeftOut()
    {
        var aggregator = Aggregator();
        var trailer = new Trailer { Id = Guid.NewGuid(), Name = "Trailer" };
        var extra = new Video { Id = Guid.NewGuid(), Name = "Behind the scenes", ExtraType = ExtraType.BehindTheScenes, OwnerId = Guid.NewGuid() };
        var missing = TestData.Episode(TestData.Series("Show"), 1, 9);
        missing.IsVirtualItem = true;
        foreach (var item in new BaseItem[] { trailer, extra, missing })
        {
            aggregator.Add(item, [Source($"/x/{item.Name}.mkv", Gb, "h264", 1920, 1080)], [Movies]);
        }

        Assert.Equal(0, aggregator.Build(TestData.Now, 0).Totals.Files);
    }

    [Fact]
    public void CountsHdrFiles()
    {
        var aggregator = Aggregator();
        aggregator.Add(TestData.Movie("HDR10"), [Source("/m/1.mkv", 10 * Gb, "hevc", 3840, 2160, Hdr10())], [Movies]);
        aggregator.Add(TestData.Movie("DV"), [Source("/m/2.mkv", 20 * Gb, "hevc", 3840, 2160, DolbyVision())], [Movies]);
        aggregator.Add(TestData.Movie("HLG"), [Source("/m/3.mkv", 5 * Gb, "hevc", 3840, 2160, Hlg())], [Movies]);
        aggregator.Add(TestData.Movie("SDR"), [Source("/m/4.mkv", 9 * Gb, "hevc", 3840, 2160)], [Movies]);

        var report = aggregator.Build(TestData.Now, 0);

        Assert.Equal((35 * Gb, 3), (report.Totals.Hdr.Size, report.Totals.Hdr.Files));
        Assert.Equal(
            [("DV", "Dolby Vision"), ("HDR10", "HDR10"), ("SDR", null), ("HLG", "HLG")],
            report.BiggestMovies.Select(m => (m.Name, m.Hdr)));
    }

    [Fact]
    public void TheBiggestSeries_AddUpTheirEpisodes_WithTheirCodecMix()
    {
        var aggregator = Aggregator();
        var big = TestData.Series("Big");
        var small = TestData.Series("Small");
        aggregator.Add(TestData.Episode(big, 1, 1), [Source("/tv/b1.mkv", 3 * Gb, "h264", 1920, 1080)], [Shows]);
        aggregator.Add(TestData.Episode(big, 1, 2), [Source("/tv/b2.mkv", 3 * Gb, "h264", 1920, 1080)], [Shows]);
        aggregator.Add(TestData.Episode(big, 1, 3), [Source("/tv/b3.mkv", 1 * Gb, "hevc", 1920, 1080)], [Shows]);
        aggregator.Add(TestData.Episode(small, 1, 1), [Source("/tv/s1.mkv", 2 * Gb, "hevc", 1920, 1080)], [Shows]);

        var report = aggregator.Build(TestData.Now, 0);

        Assert.Equal([("Big", 3, 7 * Gb), ("Small", 1, 2 * Gb)], report.BiggestSeries.Select(s => (s.Name, s.Episodes, s.Size)));
        Assert.Equal(big.Id, report.BiggestSeries[0].Id);
        Assert.Equal([("H264", 6 * Gb), ("HEVC", 1 * Gb)], report.BiggestSeries[0].Codecs.Select(c => (c.Key, c.Size)));
    }

    [Fact]
    public void TheBiggestLists_KeepTheTop15()
    {
        var aggregator = Aggregator();
        for (var i = 1; i <= 20; i++)
        {
            aggregator.Add(TestData.Movie($"M{i}"), [Source($"/m/{i}.mkv", i * Gb, "h264", 1920, 1080)], [Movies]);
        }

        var top = aggregator.Build(TestData.Now, 0).BiggestMovies;

        Assert.Equal(StorageAggregator.TopCount, top.Count);
        Assert.Equal(("M20", "M6"), (top[0].Name, top[^1].Name));
    }

    [Fact]
    public void Bitrate_ComesFromJellyfin_OrFromSizeAndRunTime()
    {
        var aggregator = Aggregator();
        var known = Source("/m/known.mkv", Gb, "h264", 1920, 1080);
        known.Bitrate = 8_000_000;
        aggregator.Add(TestData.Movie("Known"), [known], [Movies]);
        var derived = Source("/m/derived.mkv", 2 * Gb, "h264", 1920, 1080);
        derived.RunTimeTicks = TimeSpan.FromSeconds(1000).Ticks;
        aggregator.Add(TestData.Movie("Derived"), [derived], [Movies]);

        var movies = aggregator.Build(TestData.Now, 0).BiggestMovies;

        Assert.Equal([("Derived", (long?)16_000_000), ("Known", 8_000_000)], movies.Select(m => (m.Name, m.Bitrate)));
    }

    [Fact]
    public void ListsMovieAndShowLibrariesEvenWhenEmpty_ButNotMusic()
    {
        var aggregator = Aggregator();
        aggregator.AddLibrary(Guid.NewGuid(), "Music", "music");

        Assert.Equal(["Movies", "Shows"], aggregator.Build(TestData.Now, 0).Libraries.Select(l => l.Name));
    }

    private static StorageAggregator Aggregator()
    {
        var aggregator = new StorageAggregator(_ => throw new InvalidOperationException("Sized files never touch the disk."));
        aggregator.AddLibrary(Movies, "Movies", "movies");
        aggregator.AddLibrary(Shows, "Shows", "tvshows");
        return aggregator;
    }

    private static MediaSourceInfo Source(string path, long? size, string codec, int width, int height, Action<MediaStream>? hdr = null)
    {
        var video = new MediaStream { Type = MediaStreamType.Video, Index = 0, Codec = codec, Width = width, Height = height, BitDepth = 8 };
        hdr?.Invoke(video);
        return new MediaSourceInfo
        {
            Id = Guid.NewGuid().ToString("N"),
            Path = path,
            Protocol = MediaProtocol.File,
            Size = size,
            MediaStreams = [video, new MediaStream { Type = MediaStreamType.Audio, Index = 1, Codec = "aac" }],
        };
    }

    private static Action<MediaStream> Hdr10() => s =>
    {
        s.BitDepth = 10;
        s.ColorTransfer = "smpte2084";
        s.ColorPrimaries = "bt2020";
    };

    private static Action<MediaStream> Hlg() => s =>
    {
        s.BitDepth = 10;
        s.ColorTransfer = "arib-std-b67";
        s.ColorPrimaries = "bt2020";
    };

    private static Action<MediaStream> DolbyVision() => s =>
    {
        s.BitDepth = 10;
        s.DvProfile = 5;
        s.DvBlSignalCompatibilityId = 0;
        s.RpuPresentFlag = 1;
        s.BlPresentFlag = 1;
    };
}
