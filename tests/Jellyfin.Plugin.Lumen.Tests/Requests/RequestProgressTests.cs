using Jellyfin.Plugin.Lumen.Requests;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public class RequestProgressTests
{
    private static readonly DateTimeOffset Now = TestData.Now;

    [Theory]
    [InlineData(SeerrRequestStatus.Pending, RequestProgressState.Requested)]
    [InlineData(SeerrRequestStatus.Declined, RequestProgressState.Declined)]
    [InlineData(SeerrRequestStatus.Failed, RequestProgressState.Failed)]
    [InlineData(SeerrRequestStatus.Completed, RequestProgressState.Ready)]
    [InlineData(SeerrRequestStatus.Approved, RequestProgressState.Queued)]
    public void RequestStatus_WithoutDownloads(int status, string expected)
    {
        Assert.Equal(new RequestProgressInfo(expected), RequestProgress.Map(Request(status, mediaStatus: 3), Now));
    }

    [Fact]
    public void AnAvailableTitle_IsReady_WhateverTheRequestSays()
    {
        Assert.Equal(RequestProgressState.Ready, RequestProgress.Map(Request(SeerrRequestStatus.Approved, mediaStatus: 5), Now).State);
        Assert.Equal(RequestProgressState.Ready, RequestProgress.Map(Request(SeerrRequestStatus.Pending, mediaStatus: 5), Now).State);
    }

    [Fact]
    public void DeclinedAndFailed_SaySo_EvenWithAQueueEntry()
    {
        var downloading = Download(1000, 500, "downloading");
        Assert.Equal(RequestProgressState.Declined, RequestProgress.Map(Request(SeerrRequestStatus.Declined, downloads: [downloading]), Now).State);
        Assert.Equal(RequestProgressState.Failed, RequestProgress.Map(Request(SeerrRequestStatus.Failed, downloads: [downloading]), Now).State);
    }

    [Fact]
    public void AMovieDownloading_HasItsPercentAndTimeLeft()
    {
        var progress = RequestProgress.Map(Request(downloads: [Download(1000, 250, "downloading", Now.AddSeconds(90))]), Now);

        Assert.Equal(RequestProgressState.Downloading, progress.State);
        Assert.Equal(75, progress.Percent);
        Assert.Equal(90, progress.SecondsLeftAt(Now));
        Assert.Equal(60, progress.SecondsLeftAt(Now.AddSeconds(30)));
        Assert.Null(progress.SecondsLeftAt(Now.AddSeconds(91)));
        Assert.Null(progress.EpisodesTotal);
    }

    [Fact]
    public void TimeLeft_IsUnknown_WithoutAFutureEstimate()
    {
        // Seerr turns a missing estimate into the epoch (new Date(null)), or leaves it out.
        Assert.Null(RequestProgress.Map(Request(downloads: [Download(1000, 500, "downloading", DateTimeOffset.UnixEpoch)]), Now).SecondsLeftAt(Now));
        Assert.Null(RequestProgress.Map(Request(downloads: [Download(1000, 500, "downloading")]), Now).SecondsLeftAt(Now));
    }

    [Fact]
    public void WaitingInTheDownloadClient_IsQueued()
    {
        var progress = RequestProgress.Map(Request(downloads: [Download(1000, 1000, "queued", Now.AddHours(1))]), Now);

        Assert.Equal(new RequestProgressInfo(RequestProgressState.Queued, 0), progress);
        Assert.Null(progress.SecondsLeftAt(Now));
    }

    [Fact]
    public void APausedDownloadPartWayThrough_IsStillDownloading()
    {
        Assert.Equal(RequestProgressState.Downloading, RequestProgress.Map(Request(downloads: [Download(1000, 400, "paused")]), Now).State);
    }

    [Theory]
    [InlineData("completed", 0)]
    [InlineData("completed", 10)]
    [InlineData("downloading", 0)]
    public void Downloaded_WaitingToBeImported_IsProcessing(string status, double left)
    {
        Assert.Equal(new RequestProgressInfo(RequestProgressState.Processing, 100), RequestProgress.Map(Request(downloads: [Download(1000, left, status)]), Now));
    }

    [Fact]
    public void AFailedDownload_IsQueued_WhileRadarrLooksForAnotherRelease()
    {
        // Only the request's own status says the request failed; a failed queue entry is one release, blocklisted.
        Assert.Equal(new RequestProgressInfo(RequestProgressState.Queued), RequestProgress.Map(Request(downloads: [Download(1000, 600, "failed")]), Now));
    }

    [Fact]
    public void AFailedDownload_NextToItsReplacement_IsLeftOutOfTheProgress()
    {
        var progress = RequestProgress.Map(Request(downloads: [Download(1000, 600, "failed", id: "old"), Download(1000, 750, "downloading", id: "new")]), Now);

        Assert.Equal(RequestProgressState.Downloading, progress.State);
        Assert.Equal(25, progress.Percent);
    }

    [Fact]
    public void AReGrab_StartsTheProgressOver_InsteadOfCountingTheReplacedReleaseAsDone()
    {
        var memory = new DownloadMemory();
        memory.Observe([Download(8000, 6400, "downloading", id: "first")], Now);

        // The first release failed at 20% and left the queue; Radarr grabbed another of the same size.
        var regrab = new List<SeerrDownload> { Download(8000, 8000, "queued", id: "second") };
        memory.Observe(regrab, Now.AddMinutes(1));

        Assert.Equal(0, RequestProgress.Map(Request(downloads: regrab), Now.AddMinutes(1), memory).Percent);
    }

    [Fact]
    public void AReleaseLastSeenFailed_ThatLeftTheQueue_IsQueuedNotProcessing()
    {
        var memory = new DownloadMemory();
        memory.Observe([Download(1000, 600, "failed")], Now);
        memory.Observe([], Now.AddMinutes(1));

        Assert.Equal(RequestProgressState.Queued, RequestProgress.Map(Request(downloads: []), Now.AddMinutes(2), memory).State);
    }

    [Fact]
    public void AFinishedEpisode_StillCountsAsDone_WhenAnotherEpisodeIsGrabbed()
    {
        var memory = new DownloadMemory();
        memory.Observe([Download(1000, 0, "completed", null, "e1", 1, 1)], Now);
        var later = new List<SeerrDownload> { Download(1000, 1000, "queued", null, "e2", 1, 2) };
        memory.Observe(later, Now.AddMinutes(1));

        var progress = RequestProgress.Map(Request(downloads: later, type: "tv"), Now.AddMinutes(1), memory);

        Assert.Equal(50, progress.Percent);
        Assert.Equal((1, 2), (progress.EpisodesDone, progress.EpisodesTotal));
    }

    [Fact]
    public void DownloadsWithoutAnId_KeepTheirKey_AsOthersLeaveTheQueue()
    {
        // No download ids: keyed by release name and episode, so e2 is still e2 once e1 is gone (not "the first entry").
        var memory = new DownloadMemory();
        memory.Observe([Download(1000, 0, "completed", null, null, 1, 1, "Show.S01E01"), Download(3000, 1500, "downloading", null, null, 1, 2, "Show.S01E02")], Now);
        var later = new List<SeerrDownload> { Download(3000, 1500, "downloading", null, null, 1, 2, "Show.S01E02") };
        memory.Observe(later, Now.AddMinutes(1));

        var progress = RequestProgress.Map(Request(downloads: later, type: "tv"), Now.AddMinutes(1), memory);

        Assert.Equal(62.5, progress.Percent); // 1000 done + 1500 of 3000, of 4000
        Assert.Equal((1, 2), (progress.EpisodesDone, progress.EpisodesTotal));
    }

    [Fact]
    public void AShowsRequest_CountsOnlyItsOwnSeasons()
    {
        // Seerr's queue is the whole series': season 1 (requested before, by this user or another) is downloading too.
        var request = Request(type: "tv", downloads: [Download(1000, 0, "downloading", null, "s1", 1, 1), Download(1000, 900, "downloading", null, "s2e1", 2, 1), Download(1000, 1000, "queued", null, "s2e2", 2, 2)]);
        var seasonTwo = new SeerrUserRequest { Id = request.Id, Status = request.Status, Type = "tv", Seasons = [new SeerrSeasonStatus { SeasonNumber = 2 }], Media = request.Media };

        var progress = RequestProgress.Map(seasonTwo, Now);

        Assert.Equal(5, progress.Percent); // 100 of 2000
        Assert.Equal((0, 2), (progress.EpisodesDone, progress.EpisodesTotal));
        Assert.Equal((1, 3), (RequestProgress.Map(request, Now).EpisodesDone, RequestProgress.Map(request, Now).EpisodesTotal));
    }

    [Fact]
    public void A4kRequest_IsNotReady_BecauseTheHdCopyIs()
    {
        var request = Request4k(status: 5, status4k: 3, downloads4k: [Download(1000, 500, "downloading")]);

        var progress = RequestProgress.Map(request, Now);

        Assert.Equal(RequestProgressState.Downloading, progress.State);
        Assert.Equal(50, progress.Percent);
        Assert.Equal(RequestProgressState.Ready, RequestProgress.Map(Request4k(status: 3, status4k: 5), Now).State);
    }

    [Fact]
    public void ARequestCompletedBecauseItsTitleWasDeleted_IsRemoved_NotReady()
    {
        Assert.True(RequestProgress.IsRemoved(Request(SeerrRequestStatus.Completed, mediaStatus: 7)));
        Assert.False(RequestProgress.IsRemoved(Request(SeerrRequestStatus.Completed, mediaStatus: 5)));
        Assert.False(RequestProgress.IsRemoved(Request(SeerrRequestStatus.Approved, mediaStatus: 7)));

        // A 4K request goes by the 4K copy.
        Assert.True(RequestProgress.IsRemoved(Request4k(status: 5, status4k: 7, requestStatus: SeerrRequestStatus.Completed)));
        Assert.False(RequestProgress.IsRemoved(Request4k(status: 7, status4k: 5, requestStatus: SeerrRequestStatus.Completed)));
    }

    [Fact]
    public void GoneFromTheQueue_IsProcessing_UntilTheLibraryHasIt_ThenQueuedAgainAfterHours()
    {
        var memory = new DownloadMemory();
        memory.Observe([Download(1000, 0, "completed")], Now);
        var request = Request(downloads: []);

        Assert.Equal(RequestProgressState.Processing, RequestProgress.Map(request, Now.AddMinutes(3), memory).State);
        Assert.Equal(RequestProgressState.Queued, RequestProgress.Map(request, Now + RequestProgress.ProcessingWindow + TimeSpan.FromMinutes(1), memory).State);
    }

    [Fact]
    public void A4kRequest_FollowsThe4kQueue()
    {
        var request = Request4k(status: 3, status4k: 3, downloads: [Download(1000, 900, "downloading")], downloads4k: [Download(1000, 100, "downloading")]);

        Assert.Equal(90, RequestProgress.Map(request, Now).Percent);
    }

    [Fact]
    public void ASeasonPack_CountsItsBytesOnce()
    {
        // Sonarr lists a pack once per episode, each with the whole pack's size.
        var pack = Enumerable.Range(1, 3).Select(e => Download(3000, 1500, "downloading", Now.AddMinutes(10), "pack", 1, e)).ToList();

        var progress = RequestProgress.Map(Request(downloads: pack), Now);

        Assert.Equal(50, progress.Percent);
        Assert.Equal(600, progress.SecondsLeftAt(Now));
        Assert.Equal((0, 3), (progress.EpisodesDone, progress.EpisodesTotal));
    }

    [Fact]
    public void AShow_KeepsCountingEpisodesThatLeftTheQueue()
    {
        var memory = new DownloadMemory();
        var first = Enumerable.Range(1, 4).Select(e => Download(1000, 1000, "queued", null, "e" + e, 2, e)).ToList();
        memory.Observe(first, Now);

        // Two imported (gone), one half way, one still queued; the last to finish decides the time left.
        var later = new List<SeerrDownload>
        {
            Download(1000, 500, "downloading", Now.AddMinutes(5), "e3", 2, 3),
            Download(1000, 1000, "queued", Now.AddMinutes(20), "e4", 2, 4),
        };
        memory.Observe(later, Now.AddMinutes(30));
        var progress = RequestProgress.Map(Request(downloads: later), Now.AddMinutes(30), memory);

        Assert.Equal(RequestProgressState.Downloading, progress.State);
        Assert.Equal((2, 4), (progress.EpisodesDone, progress.EpisodesTotal));
        Assert.Equal(62.5, progress.Percent); // 2500 of 4000 bytes
        Assert.Null(progress.SecondsLeftAt(Now.AddMinutes(30))); // both estimates are past by then
        Assert.Equal(1200, RequestProgress.Map(Request(downloads: later), Now, memory).SecondsLeftAt(Now));
    }

    [Fact]
    public void AShowWithOneEpisodeQueued_HasNoEpisodeCount()
    {
        var progress = RequestProgress.Map(Request(downloads: [Download(1000, 500, "downloading", null, "e1", 1, 1)]), Now);

        Assert.Null(progress.EpisodesDone);
        Assert.Null(progress.EpisodesTotal);
    }

    [Fact]
    public void InFlight_IsWhatCanStillChangeOnItsOwn()
    {
        Assert.True(RequestProgressState.IsInFlight(RequestProgressState.Requested));
        Assert.True(RequestProgressState.IsInFlight(RequestProgressState.Queued));
        Assert.True(RequestProgressState.IsInFlight(RequestProgressState.Downloading));
        Assert.True(RequestProgressState.IsInFlight(RequestProgressState.Processing));
        Assert.False(RequestProgressState.IsInFlight(RequestProgressState.Ready));
        Assert.False(RequestProgressState.IsInFlight(RequestProgressState.Declined));
        Assert.False(RequestProgressState.IsInFlight(RequestProgressState.Failed));
    }

    internal static SeerrUserRequest Request(int status = SeerrRequestStatus.Approved, int mediaStatus = 3, IReadOnlyList<SeerrDownload>? downloads = null, int id = 1, int tmdbId = 603, string type = "movie") => new()
    {
        Id = id,
        Status = status,
        Type = type,
        CreatedAt = Now.AddDays(-id),
        Media = new SeerrRequestMedia { TmdbId = tmdbId, MediaType = type, Status = mediaStatus, DownloadStatus = downloads ?? [] },
    };

    internal static SeerrUserRequest Request4k(int status, int status4k, IReadOnlyList<SeerrDownload>? downloads = null, IReadOnlyList<SeerrDownload>? downloads4k = null, int requestStatus = SeerrRequestStatus.Approved) => new()
    {
        Id = 1,
        Status = requestStatus,
        Type = "movie",
        Is4k = true,
        Media = new SeerrRequestMedia
        {
            TmdbId = 603,
            MediaType = "movie",
            Status = status,
            Status4k = status4k,
            DownloadStatus = downloads ?? [],
            DownloadStatus4k = downloads4k ?? [],
        },
    };

    internal static SeerrDownload Download(double size, double left, string status, DateTimeOffset? eta = null, string? id = "d1", int? season = null, int episode = 0, string? title = null) => new()
    {
        Size = size,
        SizeLeft = left,
        Status = status,
        EstimatedCompletionTime = eta,
        DownloadId = id,
        Title = title,
        Episode = season is { } s ? new SeerrEpisode { SeasonNumber = s, EpisodeNumber = episode } : null,
    };
}
