using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>
/// Finds a title's trailer on IMDb, as an MP4 address the browser plays straight from IMDb's video CDN in a plain
/// &lt;video&gt;: it starts within a second, where YouTube's player takes several. Asked before YouTube
/// (<see cref="OnlineTrailers"/>), for titles without a local trailer.
/// </summary>
public interface IImdbTrailers
{
    /// <summary>
    /// The address of the trailer's 720p MP4 (else 480p, else 1080p) for the IMDb title <paramref name="imdbId"/>, or
    /// null: the setting is off, the id isn't an IMDb title id, IMDb has no trailer for it, or IMDb couldn't be asked.
    /// Never throws for an IMDb failure.
    /// </summary>
    Task<string?> GetAsync(string? imdbId, CancellationToken cancellationToken);

    /// <summary>The Health tab's check: one lookup of <paramref name="imdbId"/>, past the cache and the setting.</summary>
    Task<ImdbCheck> CheckAsync(string imdbId, CancellationToken cancellationToken);
}

/// <summary>
/// What a lookup found: the trailer's address (null for none), or why IMDb couldn't be asked (<paramref name="Problem"/>,
/// plain words without an address; <paramref name="Status"/> when IMDb answered with an error).
/// </summary>
public sealed record ImdbCheck(string? Url, string? Problem, HttpStatusCode? Status = null);

/// <summary>
/// <see cref="IImdbTrailers"/> over IMDb's GraphQL API, which its own site uses and which answers anonymously when asked
/// as that site is (a browser's User-Agent, its client name and origin; anything else is a 403). An answer is kept for
/// everyone, as YouTube's are (<see cref="YouTubeTrailers"/>): a trailer until an hour before its signed address expires,
/// and a day at most (<see cref="HitTtl"/>); no trailer for <see cref="MissTtl"/>; IMDb failing for
/// <see cref="FailureTtl"/>. One title is asked for once at a time, and every lookup has <see cref="Timeout"/>.
/// <para>
/// Only an address on IMDb's video CDN (<see cref="DefaultVideoOrigin"/>) is ever passed on: whatever else IMDb's answer
/// held never reaches a browser. The E2E tests point Lumen at their stub with <c>LUMEN_IMDB_API_BASE</c> (the server's
/// address for its GraphQL stand-in) and <c>LUMEN_IMDB_VIDEO_BASE</c> (the browser's address for its videos), each an
/// https address or plain http on this machine (<see cref="TestAddress"/>).
/// </para>
/// </summary>
public sealed partial class ImdbTrailers : IImdbTrailers
{
    public const string HttpClientName = "Lumen.Imdb";
    public const string ApiBaseVariable = "LUMEN_IMDB_API_BASE";
    public const string VideoBaseVariable = "LUMEN_IMDB_VIDEO_BASE";
    public const int Capacity = 2000;

    /// <summary>Of a trailer's videos, the shortest one Lumen prefers: IMDb's first is sometimes a 30-second teaser.</summary>
    public const int PreferredSeconds = 60;

    public static readonly Uri DefaultApiUrl = new("https://api.graphql.imdb.com/");
    public static readonly string DefaultVideoOrigin = "https://imdb-video.media-imdb.com";
    public static readonly TimeSpan HitTtl = TimeSpan.FromHours(24);

    /// <summary>A trailer is cached until this long before its address expires, so no browser gets one about to lapse.</summary>
    public static readonly TimeSpan ExpiryMargin = TimeSpan.FromHours(1);

    public static readonly TimeSpan MissTtl = TimeSpan.FromHours(6);
    public static readonly TimeSpan FailureTtl = TimeSpan.FromMinutes(5);

    /// <summary>Short: the hero waits 1.5 s for its slides' trailers, and a lookup still running then is cached for the next build.</summary>
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(4);

    /// <summary>Asked as IMDb's site asks: without these IMDb answers 403.</summary>
    internal const string BrowserUserAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

    /// <summary>The title's first videos (trailers come first, then clips), with their running time, kind and files.</summary>
    internal const string Query =
        "query LumenTrailer($id: ID!) { title(id: $id) { primaryVideos(first: 10) { edges { node { runtime { value } "
        + "contentType { displayName { value } } playbackURLs { url displayName { value } } } } } } }";

    /// <summary>An answer for ten videos is about 30 KB; anything much bigger isn't one.</summary>
    private const long MaxResponseBytes = 1024 * 1024;

    /// <summary>
    /// The qualities Lumen takes, in order: 720p looks right on a TV and starts quickly; 1080p is 60% bigger. "SD", which
    /// some older videos have alone, is a last resort. Never "AUTO" (HLS, which only Safari plays in a plain video).
    /// </summary>
    private static readonly string[] Qualities = ["720p", "480p", "1080p", "SD"];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly Lock _lock = new();
    private readonly Dictionary<string, Entry> _cache = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Task<string?>> _asking = new(StringComparer.Ordinal);
    private readonly IHttpClientFactory _http;
    private readonly ILumenConfigReader _config;
    private readonly TimeProvider _time;
    private readonly ILogger<ImdbTrailers> _logger;
    private long _sequence;

    public ImdbTrailers(IHttpClientFactory http, ILumenConfigReader config, TimeProvider time, ILogger<ImdbTrailers> logger)
    {
        _http = http;
        _config = config;
        _time = time;
        _logger = logger;
        ApiUrl = TestAddress.Url(Environment.GetEnvironmentVariable(ApiBaseVariable)) ?? DefaultApiUrl;
        VideoOrigin = TestAddress.Origin(Environment.GetEnvironmentVariable(VideoBaseVariable)) ?? DefaultVideoOrigin;
    }

    /// <summary>Gets where the lookups go.</summary>
    internal Uri ApiUrl { get; init; }

    /// <summary>Gets the only origin a trailer's address may have.</summary>
    internal string VideoOrigin { get; init; }

    internal int CachedCount
    {
        get
        {
            lock (_lock)
            {
                return _cache.Count;
            }
        }
    }

    /// <summary>Whether <paramref name="id"/> is an IMDb title id ("tt" and 7 to 9 digits).</summary>
    public static bool IsTitleId(string? id) => id is not null && TitleId().IsMatch(id);

    /// <summary>The IMDb title id of a movie or show, from its metadata; null for anything else or an id that isn't one.</summary>
    public static string? IdOf(BaseItem item) =>
        item is Movie or Series && item.GetProviderId(MetadataProvider.Imdb)?.Trim() is { } id && IsTitleId(id) ? id : null;

    public async Task<string?> GetAsync(string? imdbId, CancellationToken cancellationToken)
    {
        var config = _config.Current;
        if (!config.Enabled || !config.TrailerPreview || !config.YouTubeTrailers || !IsTitleId(imdbId))
        {
            return null;
        }

        TaskCompletionSource<string?>? mine = null;
        Task<string?> answer;
        lock (_lock)
        {
            if (_cache.TryGetValue(imdbId!, out var entry) && entry.Expires > _time.GetUtcNow())
            {
                return entry.Url;
            }

            if (!_asking.TryGetValue(imdbId!, out var asking))
            {
                mine = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
                asking = mine.Task;
                _asking[imdbId!] = asking;
            }

            answer = asking;
        }

        if (mine is not null)
        {
            // Not cancelled with this caller: others may be waiting for it, and the answer is cached for the next.
            _ = AskAsync(mine, imdbId!);
        }

        return await answer.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<ImdbCheck> CheckAsync(string imdbId, CancellationToken cancellationToken)
    {
        if (!IsTitleId(imdbId))
        {
            return new ImdbCheck(null, "That isn't an IMDb title id.");
        }

        try
        {
            var found = await LookUpAsync(imdbId, cancellationToken).ConfigureAwait(false);
            return new ImdbCheck(found?.Url, null);
        }
        catch (ImdbException e)
        {
            return new ImdbCheck(null, e.Message, e.Status);
        }
    }

    /// <summary>
    /// The trailer in IMDb's answer: of its videos of kind "Trailer" (never a clip or a featurette), the first that runs at
    /// least <see cref="PreferredSeconds"/>, else the first; in the first of <see cref="Qualities"/> it has as an MP4 on
    /// <paramref name="videoOrigin"/>. A video with none of those is passed over for the next. Null when there's none.
    /// </summary>
    internal static ImdbTrailer? Pick(JsonElement? title, string videoOrigin)
    {
        var trailers = Videos(title)
            .Where(v => string.Equals(v.ContentType?.DisplayName?.Value, "Trailer", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var ordered = trailers.Where(v => v.Runtime?.Value >= PreferredSeconds).Concat(trailers.Where(v => !(v.Runtime?.Value >= PreferredSeconds)));
        foreach (var video in ordered)
        {
            foreach (var quality in Qualities)
            {
                var url = (video.PlaybackUrls ?? [])
                    .Where(p => string.Equals(p?.DisplayName?.Value, quality, StringComparison.OrdinalIgnoreCase))
                    .Select(p => AllowedUrl(p!.Url, videoOrigin))
                    .FirstOrDefault(u => u is not null);
                if (url is not null)
                {
                    return new ImdbTrailer(url.AbsoluteUri, ExpiresOf(url));
                }
            }
        }

        return null;
    }

    /// <summary>
    /// <paramref name="value"/> if it's an MP4 on <paramref name="videoOrigin"/> (scheme, host and port as given, no user),
    /// else null.
    /// </summary>
    internal static Uri? AllowedUrl(string? value, string videoOrigin)
    {
        if (string.IsNullOrWhiteSpace(value)
            || !Uri.TryCreate(value, UriKind.Absolute, out var url)
            || !string.IsNullOrEmpty(url.UserInfo)
            || !string.IsNullOrEmpty(url.Fragment)
            || !string.Equals(url.GetLeftPart(UriPartial.Authority), videoOrigin, StringComparison.OrdinalIgnoreCase)
            || !url.AbsolutePath.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return url;
    }

    /// <summary>When a signed address stops working: its <c>Expires</c> (Unix seconds), or null for one without.</summary>
    internal static DateTimeOffset? ExpiresOf(Uri url)
    {
        foreach (var part in url.Query.TrimStart('?').Split('&'))
        {
            if (part.StartsWith("Expires=", StringComparison.Ordinal)
                && long.TryParse(part.AsSpan("Expires=".Length), NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)
                && seconds < 100_000_000_000)
            {
                return DateTimeOffset.FromUnixTimeSeconds(seconds);
            }
        }

        return null;
    }

    private static IEnumerable<VideoBody> Videos(JsonElement? title)
    {
        if (title is not { ValueKind: JsonValueKind.Object } value)
        {
            return [];
        }

        try
        {
            return value.Deserialize<TitleBody>(Json)?.PrimaryVideos?.Edges?.Select(e => e?.Node).OfType<VideoBody>() ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    [GeneratedRegex(@"^tt[0-9]{7,9}\z", RegexOptions.CultureInvariant)]
    private static partial Regex TitleId();

    private async Task AskAsync(TaskCompletionSource<string?> answer, string imdbId)
    {
        string? url = null;
        var now = _time.GetUtcNow();
        var expires = now + FailureTtl;
        try
        {
            var found = await LookUpAsync(imdbId, CancellationToken.None).ConfigureAwait(false);
            now = _time.GetUtcNow();
            if (found is null)
            {
                expires = now + MissTtl;
            }
            else if (found.Expires is { } lapses && lapses - ExpiryMargin <= now)
            {
                // IMDb signs its addresses for a day; one about to lapse is no use to a browser that may play it later.
                expires = now + FailureTtl;
            }
            else
            {
                url = found.Url;
                var until = now + HitTtl;
                expires = found.Expires is { } at && at - ExpiryMargin < until ? at - ExpiryMargin : until;
            }
        }
        catch (Exception e)
        {
            // Asked again after FailureTtl; YouTube's trailer, if any, plays meanwhile.
            if (_logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug("Lumen couldn't ask IMDb for a trailer: {Message}", e.Message);
            }
        }

        lock (_lock)
        {
            StoreLocked(imdbId, url, expires);
            _asking.Remove(imdbId);
        }

        answer.SetResult(url);
    }

    /// <summary>One lookup: the trailer, or null when IMDb has none. Throws <see cref="ImdbException"/> when it can't say.</summary>
    private async Task<ImdbTrailer?> LookUpAsync(string imdbId, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        var body = JsonSerializer.Serialize(new { query = Query, variables = new { id = imdbId } });
        using var request = new HttpRequestMessage(HttpMethod.Post, ApiUrl)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.TryAddWithoutValidation("User-Agent", BrowserUserAgent);
        request.Headers.Add("x-imdb-client-name", "imdb-web-next");
        request.Headers.Add("Origin", "https://www.imdb.com");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        try
        {
            using var response = await _http.CreateClient(HttpClientName)
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token)
                .ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                var status = (int)response.StatusCode;
                throw new ImdbException(
                    status is >= 300 and < 400
                        ? "IMDb's address redirected somewhere else."
                        : string.Create(CultureInfo.InvariantCulture, $"IMDb answered with HTTP {status}."))
                {
                    Status = response.StatusCode,
                };
            }

            if (response.Content.Headers.ContentLength > MaxResponseBytes)
            {
                throw new ImdbException("IMDb's answer was too big to be a title's videos.");
            }

            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
            using var document = await JsonDocument.ParseAsync(stream, default, timeout.Token).ConfigureAwait(false);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
            {
                // GraphQL's errors without data: the query itself was refused (IMDb changed its schema).
                throw new ImdbException("IMDb didn't understand Lumen's question.");
            }

            // A title IMDb doesn't know is a null title: no trailer, as for one without videos.
            return Pick(data.TryGetProperty("title", out var title) ? title : null, VideoOrigin);
        }
        catch (OperationCanceledException e) when (!cancellationToken.IsCancellationRequested)
        {
            throw new ImdbException(string.Create(CultureInfo.InvariantCulture, $"IMDb did not answer within {Timeout.TotalSeconds:0} seconds."), e);
        }
        catch (HttpRequestException e)
        {
            throw new ImdbException("Couldn't reach IMDb: " + e.Message, e);
        }
        catch (IOException e)
        {
            throw new ImdbException("IMDb's answer was cut off: " + e.Message, e);
        }
        catch (JsonException e)
        {
            throw new ImdbException("IMDb returned something Lumen doesn't understand.", e);
        }
    }

    private void StoreLocked(string imdbId, string? url, DateTimeOffset expires)
    {
        var now = _time.GetUtcNow();
        _cache.Remove(imdbId);
        if (_cache.Count >= Capacity)
        {
            foreach (var expired in _cache.Where(e => e.Value.Expires <= now).Select(e => e.Key).ToList())
            {
                _cache.Remove(expired);
            }
        }

        while (_cache.Count >= Capacity)
        {
            _cache.Remove(_cache.MinBy(e => e.Value.Sequence).Key);
        }

        _cache[imdbId] = new Entry(url, expires, ++_sequence);
    }

    private sealed record Entry(string? Url, DateTimeOffset Expires, long Sequence);

    private sealed class TitleBody
    {
        [JsonPropertyName("primaryVideos")]
        public VideosBody? PrimaryVideos { get; set; }
    }

    private sealed class VideosBody
    {
        [JsonPropertyName("edges")]
        public List<EdgeBody?>? Edges { get; set; }
    }

    private sealed class EdgeBody
    {
        [JsonPropertyName("node")]
        public VideoBody? Node { get; set; }
    }

    private sealed class VideoBody
    {
        [JsonPropertyName("runtime")]
        public ValueBody<int?>? Runtime { get; set; }

        [JsonPropertyName("contentType")]
        public ContentTypeBody? ContentType { get; set; }

        [JsonPropertyName("playbackURLs")]
        public List<PlaybackBody?>? PlaybackUrls { get; set; }
    }

    private sealed class ContentTypeBody
    {
        [JsonPropertyName("displayName")]
        public ValueBody<string?>? DisplayName { get; set; }
    }

    private sealed class PlaybackBody
    {
        [JsonPropertyName("url")]
        public string? Url { get; set; }

        [JsonPropertyName("displayName")]
        public ValueBody<string?>? DisplayName { get; set; }
    }

    private sealed class ValueBody<T>
    {
        [JsonPropertyName("value")]
        public T? Value { get; set; }
    }
}

/// <summary>A trailer on IMDb: its MP4's address and, for a signed one, when that stops working.</summary>
public sealed record ImdbTrailer(string Url, DateTimeOffset? Expires);

/// <summary>IMDb couldn't be asked, or its answer couldn't be read. The message is plain words, without an address.</summary>
public sealed class ImdbException : Exception
{
    public ImdbException()
    {
    }

    public ImdbException(string message)
        : base(message)
    {
    }

    public ImdbException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    public HttpStatusCode? Status { get; init; }
}
