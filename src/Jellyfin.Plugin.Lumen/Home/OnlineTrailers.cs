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
}

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

    private static OnlineTrailer Of(ImdbTrailer? imdb, string? youTubeId) =>
        imdb is null && string.IsNullOrEmpty(youTubeId)
            ? OnlineTrailer.None
            : new OnlineTrailer(imdb?.Url, string.IsNullOrEmpty(youTubeId) ? null : youTubeId, imdb?.UrlHd);

    private static bool IsOn(PluginConfiguration config) => config.Enabled && config.TrailerPreview && config.YouTubeTrailers;
}
