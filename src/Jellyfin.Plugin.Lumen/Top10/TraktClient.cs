using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Jellyfin.Plugin.Lumen.Configuration;

namespace Jellyfin.Plugin.Lumen.Top10;

/// <summary>Which of Trakt's weekly lists.</summary>
public enum TraktListKind
{
    Movies,
    Shows,
}

/// <summary>Reads Trakt's public lists with an app's client id (no user sign-in).</summary>
public interface ITraktClient
{
    /// <summary>The week's most watched movies or shows (by unique Trakt watchers), most watched first.</summary>
    Task<IReadOnlyList<TraktTitle>> GetWeeklyWatchedAsync(string clientId, TraktListKind kind, int limit, CancellationToken cancellationToken);
}

/// <summary>A title on a Trakt list. Either id may be missing: Trakt doesn't know every title's TMDB or IMDb id.</summary>
public sealed record TraktTitle(string? Title, int? Year, int? TmdbId, string? ImdbId);

/// <summary>A failed Trakt call; the message is fit for the admin page and the server log (it never holds the key).</summary>
public sealed class TraktException : Exception
{
    public TraktException()
    {
    }

    public TraktException(string message)
        : base(message)
    {
    }

    public TraktException(string message, Exception? innerException)
        : base(message, innerException)
    {
    }

    public HttpStatusCode? Status { get; init; }
}

/// <summary>
/// <see cref="ITraktClient"/> over <see cref="IHttpClientFactory"/>, with a short per-call timeout. Like Seerr's, the named
/// client (<see cref="HttpClientName"/>) never follows redirects (see ServiceRegistrator), so the key in its custom header
/// only ever goes to Trakt's API. Set <c>LUMEN_TRAKT_API_BASE</c> to point it somewhere else (the E2E tests' stub).
/// </summary>
public sealed class TraktClient : ITraktClient
{
    public const string HttpClientName = "Lumen.Trakt";
    public const string BaseUrlVariable = "LUMEN_TRAKT_API_BASE";
    public const int MaxLimit = 100;

    /// <summary>Shorter than the home rows' timeout, so a slow Trakt leaves time to fall back to Seerr's trending list.</summary>
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(3);

    public static readonly Uri DefaultBaseUrl = new("https://api.trakt.tv/");

    /// <summary>Lists are a few KB; anything much bigger isn't Trakt.</summary>
    private const long MaxResponseBytes = 2 * 1024 * 1024;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly IHttpClientFactory _http;

    public TraktClient(IHttpClientFactory http)
    {
        _http = http;
        BaseUrl = BaseUrlFrom(Environment.GetEnvironmentVariable(BaseUrlVariable));
    }

    /// <summary>Gets Trakt's API address (ends in a slash).</summary>
    internal Uri BaseUrl { get; init; }

    public async Task<IReadOnlyList<TraktTitle>> GetWeeklyWatchedAsync(string clientId, TraktListKind kind, int limit, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(clientId);
        var resource = kind == TraktListKind.Movies ? "movies" : "shows";
        var path = string.Create(CultureInfo.InvariantCulture, $"{resource}/watched/weekly?limit={Math.Clamp(limit, 1, MaxLimit)}");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(BaseUrl, path));
        request.Headers.Add("trakt-api-version", "2");
        request.Headers.Add("trakt-api-key", clientId);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        try
        {
            var client = _http.CreateClient(HttpClientName);
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                throw new TraktException(Describe(response.StatusCode)) { Status = response.StatusCode };
            }

            if (response.Content.Headers.ContentLength > MaxResponseBytes)
            {
                throw new TraktException("Trakt's answer was too big to be a weekly list.");
            }

            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
            var entries = await JsonSerializer.DeserializeAsync<List<EntryBody>>(stream, Json, timeout.Token).ConfigureAwait(false) ?? [];
            return entries
                .Select(e => kind == TraktListKind.Movies ? e.Movie : e.Show)
                .OfType<TitleBody>()
                .Select(t => new TraktTitle(
                    t.Title,
                    t.Year is > 0 ? t.Year : null,
                    t.Ids?.Tmdb is > 0 ? t.Ids.Tmdb : null,
                    ValidImdbId(t.Ids?.Imdb)))
                .ToList();
        }
        catch (OperationCanceledException e) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TraktException(string.Create(CultureInfo.InvariantCulture, $"Trakt did not answer within {Timeout.TotalSeconds:0} seconds."), e);
        }
        catch (HttpRequestException e)
        {
            throw new TraktException("Couldn't reach Trakt: " + e.Message, e);
        }
        catch (IOException e)
        {
            // A connection dropped while the body was read (HttpIOException is an IOException, not an
            // HttpRequestException): a TraktException too, so the caller's back-off and log-once apply to it.
            throw new TraktException("Trakt's answer was cut off: " + e.Message, e);
        }
        catch (JsonException e)
        {
            throw new TraktException("Trakt returned something Lumen doesn't understand.", e);
        }
    }

    /// <summary>The API address to use: <paramref name="value"/> when it's an http(s) URL, else Trakt's own.</summary>
    internal static Uri BaseUrlFrom(string? value) =>
        ConfigValidator.IsHttpUrl(value) ? new Uri(value!.TrimEnd('/') + "/") : DefaultBaseUrl;

    /// <summary>An IMDb id ("tt" and digits), or null for anything else.</summary>
    private static string? ValidImdbId(string? id) =>
        id is { Length: > 2 and <= 16 } && id.StartsWith("tt", StringComparison.Ordinal) && id.AsSpan(2).IndexOfAnyExceptInRange('0', '9') < 0 ? id : null;

    private static string Describe(HttpStatusCode status) => status switch
    {
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "Trakt rejected the API key. Use the Client ID of an app from trakt.tv/oauth/applications.",
        HttpStatusCode.TooManyRequests => "Trakt asked Lumen to slow down (HTTP 429).",
        >= HttpStatusCode.MultipleChoices and < HttpStatusCode.BadRequest => "Trakt's address redirected somewhere else.",
        _ => string.Create(CultureInfo.InvariantCulture, $"Trakt returned HTTP {(int)status}."),
    };

    private sealed class EntryBody
    {
        [JsonPropertyName("movie")]
        public TitleBody? Movie { get; set; }

        [JsonPropertyName("show")]
        public TitleBody? Show { get; set; }
    }

    private sealed class TitleBody
    {
        [JsonPropertyName("title")]
        public string? Title { get; set; }

        [JsonPropertyName("year")]
        public int? Year { get; set; }

        [JsonPropertyName("ids")]
        public IdsBody? Ids { get; set; }
    }

    private sealed class IdsBody
    {
        [JsonPropertyName("tmdb")]
        public int? Tmdb { get; set; }

        [JsonPropertyName("imdb")]
        public string? Imdb { get; set; }
    }
}
