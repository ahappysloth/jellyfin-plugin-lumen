using System.Collections.Concurrent;
using System.Globalization;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Providers;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>
/// The title logos laid over catalog titles' art in the home screen's landscape catalog rows (Trending, Popular…), as
/// library cards have their own: a TMDB file name each, served through the catalog image proxy like the art.
/// </summary>
public interface ICatalogLogos
{
    /// <summary>
    /// The logos of <paramref name="items"/> that are known, by <see cref="CatalogItemDto.Key"/>, after waiting at most
    /// <see cref="CatalogLogos.WaitBudget"/> for the ones being looked up. Those not back by then carry on in the
    /// background for the next load: <see cref="CatalogLogoResult.Pending"/> says so.
    /// </summary>
    Task<CatalogLogoResult> GetAsync(IEnumerable<CatalogItemDto> items, CancellationToken cancellationToken);
}

/// <summary>Finds a title's logo on TMDB: its file name, or null when it has none the image proxy can serve.</summary>
public interface ICatalogLogoSource
{
    /// <summary>Gets a value indicating whether lookups can be made at all.</summary>
    bool Available { get; }

    Task<string?> FindAsync(string mediaType, int tmdbId, CancellationToken cancellationToken);
}

/// <summary>What <see cref="ICatalogLogos.GetAsync"/> found: logos by title key, and whether more are on the way.</summary>
public sealed record CatalogLogoResult(IReadOnlyDictionary<string, string> Logos, bool Pending);

/// <summary>
/// <see cref="ICatalogLogos"/> with a memory cache in front of <see cref="ICatalogLogoSource"/>. A title is looked up
/// once (requests for it while that runs share it), then remembered for <see cref="FoundTtl"/>, or for
/// <see cref="NoneTtl"/> when it has no logo, or <see cref="FailedTtl"/> after an error. At most
/// <see cref="MaxConcurrentLookups"/> run at a time, so a home screen of new titles doesn't send TMDB a burst. A title on
/// the server (<see cref="CatalogItemDto.JellyfinItemId"/>) is never looked up: its row shows its library card, logo and
/// all.
/// </summary>
public sealed class CatalogLogos : ICatalogLogos, IDisposable
{
    public const int MaxConcurrentLookups = 2;

    /// <summary>More remembered titles than this and the cache starts over.</summary>
    public const int MaxEntries = 5000;

    public static readonly TimeSpan WaitBudget = TimeSpan.FromSeconds(1.5);
    public static readonly TimeSpan LookupTimeout = TimeSpan.FromSeconds(10);
    public static readonly TimeSpan FoundTtl = TimeSpan.FromDays(7);
    public static readonly TimeSpan NoneTtl = TimeSpan.FromDays(1);
    public static readonly TimeSpan FailedTtl = TimeSpan.FromMinutes(15);

    private readonly ConcurrentDictionary<string, Entry> _known = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, Lazy<Task<string?>>> _lookups = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _gate = new(MaxConcurrentLookups);
    private readonly ICatalogLogoSource _source;
    private readonly TimeProvider _time;
    private readonly ILogger<CatalogLogos> _logger;

    public CatalogLogos(ICatalogLogoSource source, TimeProvider time, ILogger<CatalogLogos> logger)
    {
        _source = source;
        _time = time;
        _logger = logger;
    }

    public void Dispose() => _gate.Dispose();

    public async Task<CatalogLogoResult> GetAsync(IEnumerable<CatalogItemDto> items, CancellationToken cancellationToken)
    {
        var logos = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!_source.Available)
        {
            return new CatalogLogoResult(logos, false);
        }

        var now = _time.GetUtcNow();
        var waiting = new List<(string Key, Task<string?> Lookup)>();
        foreach (var item in items.Where(i => i.JellyfinItemId is null).DistinctBy(i => i.Key))
        {
            if (_known.TryGetValue(item.Key, out var known) && known.Until > now)
            {
                if (known.File is { } file)
                {
                    logos[item.Key] = file;
                }
            }
            else
            {
                waiting.Add((item.Key, Lookup(item)));
            }
        }

        if (waiting.Count > 0)
        {
            var all = Task.WhenAll(waiting.Select(w => w.Lookup));
            await Task.WhenAny(all, Task.Delay(WaitBudget, _time, cancellationToken)).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
        }

        var pending = false;
        foreach (var (key, lookup) in waiting)
        {
            if (!lookup.IsCompleted)
            {
                pending = true;
            }
            else if (lookup.IsCompletedSuccessfully && lookup.Result is { } file)
            {
                logos[key] = file;
            }
        }

        return new CatalogLogoResult(logos, pending);
    }

    private Task<string?> Lookup(CatalogItemDto item) =>
        _lookups.GetOrAdd(item.Key, key => new Lazy<Task<string?>>(() => Task.Run(() => LookupAsync(key, item.MediaType, item.TmdbId)))).Value;

    private async Task<string?> LookupAsync(string key, string mediaType, int tmdbId)
    {
        string? file = null;
        var ttl = FailedTtl;
        try
        {
            await _gate.WaitAsync().ConfigureAwait(false);
            try
            {
                using var timeout = new CancellationTokenSource(LookupTimeout);
                file = await _source.FindAsync(mediaType, tmdbId, timeout.Token).ConfigureAwait(false);
                ttl = file is null ? NoneTtl : FoundTtl;
            }
            finally
            {
                _gate.Release();
            }
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            // Not a reason to fail anything: the card shows the title as text, and it's asked again after FailedTtl.
            if (_logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug(e, "Lumen couldn't look up the logo of {Key}", key);
            }
        }

        if (_known.Count >= MaxEntries)
        {
            _known.Clear();
        }

        _known[key] = new Entry(file, _time.GetUtcNow() + ttl);
        _lookups.TryRemove(key, out _);
        return file;
    }

    private sealed record Entry(string? File, DateTimeOffset Until);
}

/// <summary>
/// <see cref="ICatalogLogoSource"/> through Jellyfin's own TMDb image provider (the one a library's metadata uses, with
/// Jellyfin's key), looked up by TMDB id: no key or service of Lumen's own. Only PNG logos are taken (most of TMDB's
/// are); an SVG one isn't something the image proxy serves. Not available on a server whose catalog art comes from a
/// stand-in for TMDB's images (<c>LUMEN_TMDB_IMAGE_BASE</c>, the end-to-end tests): the logos real TMDB names wouldn't be
/// there, so its cards show their titles as text.
/// </summary>
public sealed class TmdbLogoSource : ICatalogLogoSource
{
    /// <summary>The name of Jellyfin's TMDb provider.</summary>
    public const string ProviderName = "TheMovieDb";

    private readonly IProviderManager _providers;
    private readonly IServerConfigurationManager _config;

    public TmdbLogoSource(IProviderManager providers, IServerConfigurationManager config)
    {
        _providers = providers;
        _config = config;
    }

    public bool Available { get; } = !ConfigValidator.IsHttpUrl(Environment.GetEnvironmentVariable("LUMEN_TMDB_IMAGE_BASE"));

    public async Task<string?> FindAsync(string mediaType, int tmdbId, CancellationToken cancellationToken)
    {
        BaseItem item = mediaType == CatalogMediaType.Tv ? new Series() : new Movie();
        item.SetProviderId(MetadataProvider.Tmdb, tmdbId.ToString(CultureInfo.InvariantCulture));
        var query = new RemoteImageQuery(ProviderName) { ImageType = ImageType.Logo, IncludeAllLanguages = true, IncludeDisabledProviders = true };
        var images = await _providers.GetAvailableRemoteImages(item, query, cancellationToken).ConfigureAwait(false);
        return Pick(images, _config.Configuration.PreferredMetadataLanguage);
    }

    /// <summary>
    /// The logo to show: in the server's metadata language, else English, else one without words of a language; the
    /// best rated first. Only a PNG the image proxy serves (<see cref="TmdbImageCache.IsAllowed"/>).
    /// </summary>
    internal static string? Pick(IEnumerable<RemoteImageInfo> images, string? language) =>
        images
            .Select(i => (Image: i, File: FileOf(i.Url)))
            .Where(c => c.File is not null && c.File.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            .OrderBy(c => LanguageRank(c.Image.Language, language))
            .ThenByDescending(c => c.Image.CommunityRating ?? 0)
            .ThenByDescending(c => c.Image.VoteCount ?? 0)
            .Select(c => c.File)
            .FirstOrDefault();

    /// <summary>"…/t/p/original/abc.png" is "abc.png", if the image proxy would serve it; else null.</summary>
    internal static string? FileOf(string? url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            return null;
        }

        var file = Path.GetFileName(uri.AbsolutePath);
        return TmdbImageCache.IsAllowed("w300", file) ? file : null;
    }

    private static int LanguageRank(string? image, string? preferred)
    {
        if (!string.IsNullOrEmpty(preferred) && string.Equals(image, preferred, StringComparison.OrdinalIgnoreCase))
        {
            return 0;
        }

        return string.Equals(image, "en", StringComparison.OrdinalIgnoreCase) ? 1 : string.IsNullOrEmpty(image) ? 2 : 3;
    }
}
