using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public class CatalogMapperTests
{
    private static readonly RequestAccess CanRequestAll = new(true, true, true, 7);
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly Jellyfin.Database.Implementations.Entities.User _user = TestData.User();

    [Theory]
    [InlineData(null, "None")]
    [InlineData(1, "None")]
    [InlineData(2, "Requested")]
    [InlineData(3, "Downloading")]
    [InlineData(4, "PartlyAvailable")]
    [InlineData(5, "Available")]
    [InlineData(6, "Blocklisted")]
    [InlineData(7, "None")]
    [InlineData(99, "None")]
    public void MapStatus_FollowsSeerrsMediaStatus(int? status, string expected) => Assert.Equal(expected, CatalogMapper.MapStatus(status));

    [Theory]
    [InlineData("/abc123.jpg", "abc123.jpg")]
    [InlineData("abc123.png", "abc123.png")]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("/../etc/passwd", null)]
    [InlineData("/a/b.jpg", null)]
    [InlineData("/abc.gif", null)]
    [InlineData("/ab-c.jpg", null)]
    public void ImageFile_StripsTheSlash_AndRejectsAnythingTheProxyWouldnt(string? path, string? expected) =>
        Assert.Equal(expected, CatalogMapper.ImageFile(path));

    [Fact]
    public void GenreNames_MapMovieAndTvIds_SkippingUnknown()
    {
        Assert.Equal(["Action", "Science Fiction", "Action & Adventure", "Sci-Fi & Fantasy"], CatalogMapper.GenreNames([28, 878, 123456, 10759, 10765]));
        Assert.Empty(CatalogMapper.GenreNames(null));
    }

    [Fact]
    public void TrailerUrl_UsesTheFirstValidYouTubeTrailer()
    {
        SeerrVideo[] videos =
        [
            new() { Site = "YouTube", Type = "Teaser", Key = "teaser12345" },
            new() { Site = "Vimeo", Type = "Trailer", Key = "vimeo123456" },
            new() { Site = "YouTube", Type = "Trailer", Key = "bad\"key/../x" },
            new() { Site = "YouTube", Type = "Trailer", Key = "dQw4w9WgXcQ" },
            new() { Site = "YouTube", Type = "Trailer", Key = "second12345" },
        ];

        Assert.Equal("https://www.youtube.com/watch?v=dQw4w9WgXcQ", CatalogMapper.TrailerUrl(videos));
    }

    [Theory]
    [InlineData("short")]
    [InlineData("waytoolongforayoutubekey")]
    [InlineData("abc def ghi")]
    [InlineData("abc?x=1&y")]
    public void TrailerUrl_RejectsInvalidKeys(string key) =>
        Assert.Null(CatalogMapper.TrailerUrl([new SeerrVideo { Site = "YouTube", Type = "Trailer", Key = key }]));

    [Fact]
    public void ToItems_MapsMoviesAndShows_AndDropsPeople()
    {
        var items = Mapper().ToItems(
            [
                new SeerrMedia { MediaType = "movie", Id = 603, Title = "The Matrix", ReleaseDate = "1999-03-30", VoteAverage = 8.216, GenreIds = [28, 878], PosterPath = "/p603.jpg", BackdropPath = "/b603.jpg", Overview = "Neo." },
                new SeerrMedia { MediaType = "person", Id = 6384, Name = "Keanu Reeves" },
                new SeerrMedia { MediaType = "tv", Id = 1399, Name = "Lumen Saga", FirstAirDate = "2011-04-17", VoteAverage = 0, MediaInfo = new SeerrMediaInfo { Status = 2 } },
                new SeerrMedia { MediaType = "tv", Id = 0, Name = "No id" },
            ],
            _user);

        Assert.Equal(2, items.Count);
        Assert.Equal(
            new CatalogItemDto("movie-603", "movie", 603, "The Matrix", 1999, "Neo.", 8.2, items[0].GenreNames, "p603.jpg", "b603.jpg", "None", null),
            items[0]);
        Assert.Equal(["Action", "Science Fiction"], items[0].GenreNames);
        Assert.Equal(("tv-1399", "Lumen Saga", 2011, (double?)null, "Requested", (string?)null), (items[1].Key, items[1].Title, items[1].Year, items[1].Rating, items[1].State, items[1].Overview));
        Assert.Null(items[1].Poster);
    }

    [Fact]
    public void ToItems_RespectsTake()
    {
        var results = Enumerable.Range(1, 20).Select(i => new SeerrMedia { MediaType = "movie", Id = i, Title = "M" + i }).ToList();

        Assert.Equal(12, Mapper().ToItems(results, _user, 12).Count);
    }

    [Fact]
    public void JellyfinItemId_OnlyWhenAvailableAndVisibleToTheUser()
    {
        var visible = Guid.NewGuid();
        var hidden = Guid.NewGuid();
        _library.GetItemById<BaseItem>(visible, _user).Returns(TestData.Movie("Visible"));
        _library.GetItemById<BaseItem>(hidden, _user).Returns((BaseItem?)null);
        var mapper = Mapper();

        string? Id(int status, string? jellyfinId, Jellyfin.Database.Implementations.Entities.User? user = null) =>
            mapper.ToItem("movie", new SeerrMedia { Id = 1, MediaInfo = new SeerrMediaInfo { Status = status, JellyfinMediaId = jellyfinId } }, user ?? _user)!.JellyfinItemId;

        Assert.Equal(visible.ToString("N"), Id(5, visible.ToString()));
        Assert.Equal(visible.ToString("N"), Id(4, visible.ToString("N")));
        Assert.Null(Id(5, hidden.ToString("N")));
        Assert.Null(Id(3, visible.ToString("N")));
        Assert.Null(Id(5, "not-a-guid"));
        Assert.Null(Id(5, null));
        Assert.Null(mapper.ToItem("movie", new SeerrMedia { Id = 1, MediaInfo = new SeerrMediaInfo { Status = 5, JellyfinMediaId = visible.ToString() } }, null)!.JellyfinItemId);
    }

    [Fact]
    public void Seasons_UseAvailability_ThenNonDeclinedRequests()
    {
        var title = new SeerrTitle
        {
            Id = 1399,
            Seasons = Enumerable.Range(0, 7).Reverse().Select(n => new SeerrSeason { SeasonNumber = n, Name = n == 6 ? string.Empty : "S" + n, EpisodeCount = n * 2 }).ToList(),
            MediaInfo = new SeerrMediaInfo
            {
                Status = 4,
                Seasons = [new() { SeasonNumber = 1, Status = 5 }, new() { SeasonNumber = 2, Status = 4 }, new() { SeasonNumber = 3, Status = 3 }, new() { SeasonNumber = 6, Status = 2 }],
                Requests =
                [
                    new() { Status = 2, Seasons = [new() { SeasonNumber = 1 }, new() { SeasonNumber = 4 }] },
                    new() { Status = 3, Seasons = [new() { SeasonNumber = 5 }] },
                    new() { Status = 1, Seasons = [new() { SeasonNumber = 6 }] },
                ],
            },
        };

        var seasons = CatalogMapper.Seasons(title);

        Assert.Equal([1, 2, 3, 4, 5, 6], seasons.Select(s => s.Number));
        Assert.Equal(["Available", "PartlyAvailable", "Downloading", "Requested", "None", "Requested"], seasons.Select(s => s.State));
        Assert.Equal("Season 6", seasons[5].Name);
        Assert.Equal(8, seasons[3].EpisodeCount);
    }

    [Fact]
    public void ToTitle_Movie_MapsDetails()
    {
        var title = new SeerrTitle
        {
            Id = 603,
            Title = "The Matrix",
            ReleaseDate = "1999-03-30",
            Runtime = 136,
            GenreIds = [12],
            Genres = [new() { Id = 28, Name = "Action" }, new() { Id = 878, Name = "Science Fiction" }],
            Credits = new SeerrCredits { Cast = Enumerable.Range(1, 20).Select(i => new SeerrCastMember { Id = i, Name = "Actor " + i, Character = i == 1 ? "Neo" : string.Empty, ProfilePath = i == 1 ? "/neo.jpg" : null }).ToList() },
            RelatedVideos = [new() { Site = "YouTube", Type = "Trailer", Key = "dQw4w9WgXcQ" }],
        };
        var recommendations = Enumerable.Range(1, 15).Select(i => new CatalogItemDto("movie-" + i, "movie", i, "R", null, null, null, [], null, null, "None", null)).ToList();

        var dto = Mapper().ToTitle("movie", title, recommendations, CanRequestAll, _user);

        Assert.Equal(("movie-603", "The Matrix", 1999, 136), (dto.Key, dto.Title, dto.Year, dto.Runtime));
        Assert.Equal(["Action", "Science Fiction"], dto.GenreNames);
        Assert.Equal("https://www.youtube.com/watch?v=dQw4w9WgXcQ", dto.TrailerUrl);
        Assert.Equal(15, dto.Cast.Count);
        Assert.Equal(new CatalogCastDto(1, "Actor 1", "Neo", "neo.jpg"), dto.Cast[0]);
        Assert.Null(dto.Cast[1].Character);
        Assert.Equal(12, dto.Recommendations.Count);
        Assert.Empty(dto.Seasons);
        Assert.True(dto.CanRequest);
    }

    [Theory]
    [InlineData(null, true, true)]
    [InlineData(2, true, false)]
    [InlineData(3, true, false)]
    [InlineData(7, true, true)]
    [InlineData(5, true, false)]
    [InlineData(6, true, false)]
    [InlineData(null, false, false)]
    public void ToTitle_Movie_CanRequest(int? status, bool canRequestMovies, bool expected)
    {
        var access = new RequestAccess(true, canRequestMovies, true, 7);
        var title = new SeerrTitle { Id = 1, Title = "M", MediaInfo = status is null ? null : new SeerrMediaInfo { Status = status } };

        Assert.Equal(expected, Mapper().ToTitle("movie", title, [], access, _user).CanRequest);
    }

    [Fact]
    public void ToTitle_Tv_CanRequestOnlyWhileASeasonIsLeft()
    {
        SeerrTitle Show(params (int Season, int Status)[] states) => new()
        {
            Id = 1399,
            Name = "Lumen Saga",
            Runtime = 50,
            Seasons = [new() { SeasonNumber = 0, Name = "Specials" }, new() { SeasonNumber = 1, Name = "S1" }, new() { SeasonNumber = 2, Name = "S2" }],
            MediaInfo = new SeerrMediaInfo { Status = 4, Seasons = states.Select(s => new SeerrSeasonStatus { SeasonNumber = s.Season, Status = s.Status }).ToList() },
        };
        var mapper = Mapper();

        var partly = mapper.ToTitle("tv", Show((1, 5)), [], CanRequestAll, _user);
        Assert.True(partly.CanRequest);
        Assert.Null(partly.Runtime);
        Assert.Equal([1, 2], partly.Seasons.Select(s => s.Number));
        Assert.False(mapper.ToTitle("tv", Show((1, 5), (2, 3)), [], CanRequestAll, _user).CanRequest);
        Assert.False(mapper.ToTitle("tv", Show((1, 5)), [], new RequestAccess(true, true, false, 7), _user).CanRequest);
    }

    private CatalogMapper Mapper() => new(_library);
}
