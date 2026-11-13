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
/// A title's trailer online, for one without a local trailer, while "Use online trailers" is on: at most one of the two
/// is set. <paramref name="ImdbUrl"/> is an MP4 on IMDb's video CDN (<see cref="ImdbTrailers"/>);
/// <paramref name="YouTubeId"/> a checked YouTube video id (<see cref="Home.YouTubeId"/>), never a URL.
/// </summary>
public sealed record OnlineTrailer(string? ImdbUrl, string? YouTubeId)
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

        if (await _imdb.GetAsync(ImdbTrailers.IdOf(item), cancellationToken).ConfigureAwait(false) is { Length: > 0 } url)
        {
            return new OnlineTrailer(url, null);
        }

        return await _youTube.GetAsync(item, user, cancellationToken).ConfigureAwait(false) is { Length: > 0 } id
            ? new OnlineTrailer(null, id)
            : OnlineTrailer.None;
    }

    public async Task<OnlineTrailer> GetAsync(SeerrTitle title, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(title);
        if (!IsOn(_config.Current))
        {
            return OnlineTrailer.None;
        }

        if (await _imdb.GetAsync(title.ImdbTitleId, cancellationToken).ConfigureAwait(false) is { Length: > 0 } url)
        {
            return new OnlineTrailer(url, null);
        }

        return YouTubeTrailers.FromSeerr(title.RelatedVideos) is { } id ? new OnlineTrailer(null, id) : OnlineTrailer.None;
    }

    private static bool IsOn(PluginConfiguration config) => config.Enabled && config.TrailerPreview && config.YouTubeTrailers;
}
