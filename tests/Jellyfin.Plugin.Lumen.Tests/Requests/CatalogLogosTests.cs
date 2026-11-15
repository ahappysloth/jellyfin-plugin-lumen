using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Configuration;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Providers;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public sealed class CatalogLogosTests : IDisposable
{
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly FakeSource _source = new();
    private readonly CatalogLogos _logos;

    public CatalogLogosTests()
    {
        _logos = new CatalogLogos(_source, _time, NullLogger<CatalogLogos>.Instance);
    }

    public void Dispose() => _logos.Dispose();

    [Fact]
    public async Task LooksATitleUpOnce_ThenRemembersItsLogo()
    {
        _source.Files[("movie", 1)] = "one.png";

        var first = await _logos.GetAsync([Item("movie", 1), Item("movie", 1)], CancellationToken.None);
        var second = await _logos.GetAsync([Item("movie", 1)], CancellationToken.None);

        Assert.Equal("one.png", first.Logos["movie-1"]);
        Assert.False(first.Pending);
        Assert.Equal("one.png", second.Logos["movie-1"]);
        Assert.Equal(1, _source.Calls);
    }

    [Fact]
    public async Task NeverLooksUpATitleOnTheServer()
    {
        var result = await _logos.GetAsync([Item("tv", 2) with { JellyfinItemId = "abc" }], CancellationToken.None);

        Assert.Empty(result.Logos);
        Assert.Equal(0, _source.Calls);
    }

    [Fact]
    public async Task ATitleWithoutALogo_IsAskedAgainOnlyAfterADay()
    {
        await _logos.GetAsync([Item("movie", 3)], CancellationToken.None);
        await _logos.GetAsync([Item("movie", 3)], CancellationToken.None);
        Assert.Equal(1, _source.Calls);

        _time.Advance(CatalogLogos.NoneTtl);
        _source.Files[("movie", 3)] = "late.png";
        var later = await _logos.GetAsync([Item("movie", 3)], CancellationToken.None);

        Assert.Equal(2, _source.Calls);
        Assert.Equal("late.png", later.Logos["movie-3"]);
    }

    [Fact]
    public async Task AFailedLookup_FailsNothing_AndIsTriedAgainAfterAWhile()
    {
        _source.Throw = true;
        var failed = await _logos.GetAsync([Item("movie", 4)], CancellationToken.None);
        Assert.Empty(failed.Logos);
        Assert.False(failed.Pending);

        _source.Throw = false;
        _source.Files[("movie", 4)] = "four.png";
        await _logos.GetAsync([Item("movie", 4)], CancellationToken.None);
        Assert.Equal(1, _source.Calls);

        _time.Advance(CatalogLogos.FailedTtl);
        Assert.Equal("four.png", (await _logos.GetAsync([Item("movie", 4)], CancellationToken.None)).Logos["movie-4"]);
    }

    [Fact]
    public async Task ASlowLookup_IsNotWaitedForPastTheBudget_AndIsThereNextTime()
    {
        var slow = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        _source.Pending = slow.Task;

        var waiting = _logos.GetAsync([Item("movie", 5)], CancellationToken.None);
        await WaitUntil(() => _source.Calls == 1);
        _time.Advance(CatalogLogos.WaitBudget);
        var first = await waiting;

        Assert.True(first.Pending);
        Assert.Empty(first.Logos);

        // The next load joins the lookup still under way rather than starting another.
        slow.SetResult("five.png");
        var next = await _logos.GetAsync([Item("movie", 5)], CancellationToken.None);
        Assert.Equal("five.png", next.Logos["movie-5"]);
        Assert.Equal(1, _source.Calls);
    }

    [Fact]
    public async Task RunsAtMostTwoLookupsAtATime()
    {
        var gate = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        _source.Pending = gate.Task;

        var waiting = _logos.GetAsync([Item("movie", 10), Item("movie", 11), Item("movie", 12), Item("movie", 13)], CancellationToken.None);
        await WaitUntil(() => _source.Calls == CatalogLogos.MaxConcurrentLookups);
        await Task.Delay(50);
        Assert.Equal(CatalogLogos.MaxConcurrentLookups, _source.Calls);

        gate.SetResult(null);
        await WaitUntil(() => _source.Calls == 4);
        _time.Advance(CatalogLogos.WaitBudget);
        await waiting;
    }

    [Fact]
    public async Task LooksNothingUp_WhereLookupsArentAvailable()
    {
        _source.Available = false;

        var result = await _logos.GetAsync([Item("movie", 6)], CancellationToken.None);

        Assert.Empty(result.Logos);
        Assert.False(result.Pending);
        Assert.Equal(0, _source.Calls);
    }

    [Fact]
    public void PicksAPngLogo_InTheServersLanguage_ThenEnglish_ThenWithoutWords_BestRatedFirst()
    {
        RemoteImageInfo Logo(string file, string? language, double rating = 5) =>
            new() { Url = $"https://image.tmdb.org/t/p/original/{file}", Language = language, CommunityRating = rating, ProviderName = TmdbLogoSource.ProviderName };

        Assert.Equal("fr.png", TmdbLogoSource.Pick([Logo("en.png", "en"), Logo("fr.png", "fr"), Logo("none.png", null)], "fr"));
        Assert.Equal("en2.png", TmdbLogoSource.Pick([Logo("none.png", null), Logo("en1.png", "en", 4), Logo("en2.png", "en", 8)], "de"));
        Assert.Equal("none.png", TmdbLogoSource.Pick([Logo("ja.png", "ja"), Logo("none.png", null)], "en"));

        // An SVG logo isn't something the image proxy serves.
        Assert.Equal("ok.png", TmdbLogoSource.Pick([Logo("vector.svg", "en", 9), Logo("ok.png", "en", 1)], "en"));
        Assert.Null(TmdbLogoSource.Pick([Logo("vector.svg", "en")], "en"));
        Assert.Null(TmdbLogoSource.Pick([], "en"));
    }

    [Fact]
    public async Task TheTmdbSource_AsksJellyfinsTmdbProviderByTmdbId_AndTakesALogo()
    {
        var providers = Substitute.For<IProviderManager>();
        BaseItem? asked = null;
        RemoteImageQuery? query = null;
        providers.GetAvailableRemoteImages(Arg.Do<BaseItem>(i => asked = i), Arg.Do<RemoteImageQuery>(q => query = q), Arg.Any<CancellationToken>())
            .Returns([
                new RemoteImageInfo { Url = "https://image.tmdb.org/t/p/original/poster.jpg", Type = ImageType.Primary },
                new RemoteImageInfo { Url = "https://image.tmdb.org/t/p/original/logo.png", Type = ImageType.Logo, Language = "en" },
            ]);

        var file = await Source(providers).FindAsync("tv", 1399, CancellationToken.None);

        Assert.Equal("logo.png", file);
        Assert.IsType<MediaBrowser.Controller.Entities.TV.Series>(asked);
        Assert.Equal("1399", asked!.GetProviderId(MetadataProvider.Tmdb));
        Assert.Equal(TmdbLogoSource.ProviderName, query!.ProviderName);
    }

    [Fact]
    public async Task TheTmdbSource_SaysNoLogo_ForATitleWithImagesButNoLogo_AndFails_WhenTmdbGaveNothingAtAll()
    {
        var providers = Substitute.For<IProviderManager>();
        providers.GetAvailableRemoteImages(default!, default!, default).ReturnsForAnyArgs(
            [new RemoteImageInfo { Url = "https://image.tmdb.org/t/p/original/poster.jpg", Type = ImageType.Primary }]);
        Assert.Null(await Source(providers).FindAsync("movie", 603, CancellationToken.None));

        // Jellyfin answers a TMDb error or time-out with no images at all: that's a failed lookup, not "no logo".
        providers.GetAvailableRemoteImages(default!, default!, default).ReturnsForAnyArgs(Array.Empty<RemoteImageInfo>());
        await Assert.ThrowsAsync<CatalogLogoException>(() => Source(providers).FindAsync("movie", 603, CancellationToken.None));
    }

    [Theory]
    [InlineData("https://image.tmdb.org/t/p/original/abc123.png", "abc123.png")]
    [InlineData("https://image.tmdb.org/t/p/w500/abc123.png?x=1", "abc123.png")]
    [InlineData("https://image.tmdb.org/t/p/original/../../etc.png", "etc.png")]
    [InlineData("https://image.tmdb.org/t/p/original/a-b.png", null)]
    [InlineData("not a url", null)]
    [InlineData(null, null)]
    public void FileOf_TakesOnlyAFileNameTheImageProxyServes(string? url, string? expected) =>
        Assert.Equal(expected, TmdbLogoSource.FileOf(url));

    private static TmdbLogoSource Source(IProviderManager providers)
    {
        var config = Substitute.For<IServerConfigurationManager>();
        config.Configuration.Returns(new ServerConfiguration { PreferredMetadataLanguage = "en" });
        return new TmdbLogoSource(providers, config);
    }

    private static CatalogItemDto Item(string mediaType, int tmdbId) =>
        new($"{mediaType}-{tmdbId}", mediaType, tmdbId, "T", null, null, null, [], null, "b.jpg", "None", null);

    private static async Task WaitUntil(Func<bool> done)
    {
        for (var i = 0; i < 200 && !done(); i++)
        {
            await Task.Delay(10);
        }

        Assert.True(done());
    }

    private sealed class FakeSource : ICatalogLogoSource
    {
        private int _calls;

        public Dictionary<(string MediaType, int TmdbId), string> Files { get; } = [];

        public Task<string?>? Pending { get; set; }

        public bool Throw { get; set; }

        public bool Available { get; set; } = true;

        public int Calls => Volatile.Read(ref _calls);

        public async Task<string?> FindAsync(string mediaType, int tmdbId, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _calls);
            if (Throw)
            {
                throw new HttpRequestException("down");
            }

            return Pending is { } pending ? await pending : Files.GetValueOrDefault((mediaType, tmdbId));
        }
    }
}
