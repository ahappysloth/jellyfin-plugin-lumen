using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Finds a title's trailer online: IMDb's first, as it starts at once; else YouTube's.</summary>
public interface IOnlineTrailers
{
    /// <summary>
    /// A library title's trailer online, by the IMDb id and the TMDB id in its metadata. Callers check for a local trailer
    /// first: that one wins. Never throws for an IMDb or Seerr failure.
    /// </summary>
    Task<OnlineTrailer> GetAsync(BaseItem item, User user, CancellationToken cancellationToken);

    /// <summary>A catalog title's trailer online, by the IMDb id and the videos Seerr has for it.</summary>
    Task<OnlineTrailer> GetAsync(SeerrTitle title, CancellationToken cancellationToken);

    /// <summary>
    /// For a library title's Media info: what <see cref="GetAsync(BaseItem, User, CancellationToken)"/> finds and why,
    /// each source's answer as the server has it cached (<paramref name="refresh"/>: asked again). Nothing is asked while
    /// a setting is off. With <paramref name="hasLocalTrailer"/>, which wins, the online ones are still looked up (the
    /// hero and the title page never ask for them then), so Media info says what would play without it.
    /// </summary>
    Task<TrailerDiagnosis> DiagnoseAsync(BaseItem item, User user, bool hasLocalTrailer, bool refresh, CancellationToken cancellationToken);

    /// <summary>The same for a catalog title: its YouTube trailer comes with Seerr's details of it, so only IMDb is refreshed.</summary>
    Task<TrailerDiagnosis> DiagnoseAsync(SeerrTitle title, bool refresh, CancellationToken cancellationToken);
}

/// <summary>
/// A title's trailer diagnosis (GET …/TrailerInfo): whether previews and "Use online trailers" are on, whether a local
/// trailer exists (null for a catalog title; it plays instead of the online ones), why nothing was asked
/// (<see cref="TrailerSkip"/>), and each source's answer.
/// </summary>
public sealed record TrailerDiagnosis(bool Previews, bool Online, bool? LocalTrailer, string? Skipped, ImdbDiagnosis Imdb, YouTubeDiagnosis YouTube);

/// <summary>
/// A title's trailer online, for one without a local trailer, while "Use online trailers" is on. <paramref name="ImdbUrl"/>
/// is an MP4 on IMDb's video CDN (<see cref="ImdbTrailers"/>), with <paramref name="ImdbUrlHd"/> its 1080p MP4 there when
/// IMDb has that besides; <paramref name="YouTubeId"/> a checked YouTube video id (<see cref="Home.YouTubeId"/>), never a
/// URL: the browser's fallback should IMDb's file not play there.
/// </summary>
public sealed record OnlineTrailer(string? ImdbUrl, string? YouTubeId, string? ImdbUrlHd = null)
{
    public static readonly OnlineTrailer None = new(null, null);
}

/// <summary>
/// <see cref="IOnlineTrailers"/>. The IMDb id only ever comes from the item's metadata or Seerr's answer, checked
/// (<see cref="ImdbTrailers.IsTitleId"/>), never from the browser.
/// </summary>
public sealed class OnlineTrailers : IOnlineTrailers
{
    private readonly IImdbTrailers _imdb;
    private readonly IYouTubeTrailers _youTube;
    private readonly ILumenConfigReader _config;

    public OnlineTrailers(IImdbTrailers imdb, IYouTubeTrailers youTube, ILumenConfigReader config)
    {
        _imdb = imdb;
        _youTube = youTube;
        _config = config;
    }

    public async Task<OnlineTrailer> GetAsync(BaseItem item, User user, CancellationToken cancellationToken)
    {
        if (!IsOn(_config.Current))
        {
            return OnlineTrailer.None;
        }

        // Both, side by side: YouTube's is the browser's fallback should IMDb's file not play there (a proxy's policy, an
        // ad blocker, IMDb refusing it), and asking at once costs no more time than asking IMDb alone.
        var imdb = _imdb.GetAsync(ImdbTrailers.IdOf(item), cancellationToken);
        var youTube = _youTube.GetAsync(item, user, cancellationToken);
        return Of(await imdb.ConfigureAwait(false), await youTube.ConfigureAwait(false));
    }

    public async Task<OnlineTrailer> GetAsync(SeerrTitle title, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(title);
        if (!IsOn(_config.Current))
        {
            return OnlineTrailer.None;
        }

        return Of(await _imdb.GetAsync(title.ImdbTitleId, cancellationToken).ConfigureAwait(false), YouTubeTrailers.FromSeerr(title.RelatedVideos));
    }

    public async Task<TrailerDiagnosis> DiagnoseAsync(BaseItem item, User user, bool hasLocalTrailer, bool refresh, CancellationToken cancellationToken)
    {
        var config = _config.Current;
        var imdbId = ImdbTrailers.IdOf(item);
        if (SkipOf(config) is { } skipped)
        {
            return Skip(config, hasLocalTrailer, skipped, imdbId);
        }

        // Side by side, as for the trailer itself.
        var imdb = _imdb.DiagnoseAsync(imdbId, refresh, cancellationToken);
        var youTube = _youTube.DiagnoseAsync(item, user, refresh, cancellationToken);
        return new TrailerDiagnosis(true, true, hasLocalTrailer, null, await imdb.ConfigureAwait(false), await youTube.ConfigureAwait(false));
    }

    public async Task<TrailerDiagnosis> DiagnoseAsync(SeerrTitle title, bool refresh, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(title);
        var config = _config.Current;
        if (SkipOf(config) is { } skipped)
        {
            return Skip(config, null, skipped, ImdbTrailers.IsTitleId(title.ImdbTitleId) ? title.ImdbTitleId : null);
        }

        var imdb = await _imdb.DiagnoseAsync(title.ImdbTitleId, refresh, cancellationToken).ConfigureAwait(false);
        var id = YouTubeTrailers.FromSeerr(title.RelatedVideos);
        var youTube = new YouTubeDiagnosis(
            id,
            id is null ? null : TrailerSource.Seerr,
            new TrailerOutcome(id is null ? TrailerStatus.NotFound : TrailerStatus.Found, null, null),
            false);
        return new TrailerDiagnosis(true, true, null, null, imdb, youTube);
    }

    private static string? SkipOf(PluginConfiguration config) =>
        !config.TrailerPreview ? TrailerSkip.PreviewsOff
        : !config.YouTubeTrailers ? TrailerSkip.OnlineOff
        : null;

    private static TrailerDiagnosis Skip(PluginConfiguration config, bool? hasLocalTrailer, string skipped, string? imdbId)
    {
        var outcome = new TrailerOutcome(TrailerStatus.Skipped, null, null);
        return new TrailerDiagnosis(
            config.TrailerPreview,
            config.YouTubeTrailers,
            hasLocalTrailer,
            skipped,
            new ImdbDiagnosis(imdbId, outcome, [], false),
            new YouTubeDiagnosis(null, null, outcome, false));
    }

    private static OnlineTrailer Of(ImdbTrailer? imdb, string? youTubeId) =>
        imdb is null && string.IsNullOrEmpty(youTubeId)
            ? OnlineTrailer.None
            : new OnlineTrailer(imdb?.Url, string.IsNullOrEmpty(youTubeId) ? null : youTubeId, imdb?.UrlHd);

    private static bool IsOn(PluginConfiguration config) => config.Enabled && config.TrailerPreview && config.YouTubeTrailers;
}
