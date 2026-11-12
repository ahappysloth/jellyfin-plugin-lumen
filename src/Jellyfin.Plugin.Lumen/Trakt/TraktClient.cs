using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Jellyfin.Plugin.Lumen.Configuration;

namespace Jellyfin.Plugin.Lumen.Trakt;

/// <summary>Reads Trakt's public lists with an app's client id (no user sign-in).</summary>
public interface ITraktClient
{
    /// <summary>A list's titles in Trakt's order, up to <see cref="TraktQuery.Limit"/>, following Trakt's pages.</summary>
    Task<IReadOnlyList<TraktTitle>> GetTitlesAsync(string clientId, TraktQuery query, CancellationToken cancellationToken);

    /// <summary>A user's list's name. A private or missing list fails with <see cref="TraktException.Status"/> set.</summary>
    Task<string?> GetListNameAsync(string clientId, TraktListRef list, CancellationToken cancellationToken);
}

/// <summary>A title on a Trakt list. Either id may be missing: Trakt doesn't know every title's TMDB or IMDb id.</summary>
public sealed record TraktTitle(string? Title, int? Year, int? TmdbId, string? ImdbId, TraktListKind Kind = TraktListKind.Movies);

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

    /// <summary>Gets a value indicating whether Trakt said the list isn't there for Lumen: private, deleted, or never was.</summary>
    public bool IsMissing => Status is HttpStatusCode.NotFound or HttpStatusCode.Forbidden or HttpStatusCode.Unauthorized;
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

    /// <summary>The most Trakt gives in one page.</summary>
    public const int MaxLimit = 100;

    /// <summary>Pages read for one list at most: a list Lumen reads is 100 titles, a page or a few if Trakt pages smaller.</summary>
    public const int MaxPages = 5;

    /// <summary>Shorter than the home rows' timeout, so a slow Trakt leaves time to fall back to Seerr's trending list.</summary>
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(3);

    public static readonly Uri DefaultBaseUrl = new("https://api.trakt.tv/");

    /// <summary>Lists are tens of KB at most; anything much bigger isn't Trakt.</summary>
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

    public async Task<IReadOnlyList<TraktTitle>> GetTitlesAsync(string clientId, TraktQuery query, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(clientId);
        ArgumentNullException.ThrowIfNull(query);
        var limit = Math.Max(query.Limit, 1);
        var perPage = Math.Min(limit, MaxLimit);
        var titles = new List<TraktTitle>();
        for (var page = 1; page <= MaxPages && titles.Count < limit; page++)
        {
            var path = string.Create(CultureInfo.InvariantCulture, $"{query.Path}?page={page}&limit={perPage}");
            var (entries, pageCount) = await GetAsync<List<EntryBody>>(clientId, path, query.List is not null, cancellationToken).ConfigureAwait(false);
            titles.AddRange((entries ?? []).Select(e => ToTitle(e, query.Content)).OfType<TraktTitle>());

            // Lists without pages (the box office) say nothing: one call is all of it. So is a short page.
            if (pageCount is not { } count || page >= count || entries is not { Count: > 0 })
            {
                break;
            }
        }

        return titles.Count > limit ? titles.GetRange(0, limit) : titles;
    }

    public async Task<string?> GetListNameAsync(string clientId, TraktListRef list, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(clientId);
        ArgumentNullException.ThrowIfNull(list);
        var (body, _) = await GetAsync<ListBody>(clientId, list.ApiPath, true, cancellationToken).ConfigureAwait(false);
        return string.IsNullOrWhiteSpace(body?.Name) ? null : body.Name.Trim();
    }

    /// <summary>The API address to use: <paramref name="value"/> when it's an http(s) URL, else Trakt's own.</summary>
    internal static Uri BaseUrlFrom(string? value) =>
        ConfigValidator.IsHttpUrl(value) ? new Uri(value!.TrimEnd('/') + "/") : DefaultBaseUrl;

    /// <summary>An entry's title, or null for one that holds none of what the list should (a person, a season).</summary>
    private static TraktTitle? ToTitle(EntryBody entry, TraktContent content)
    {
        var (title, kind) = content switch
        {
            TraktContent.Movies => (entry.Movie, TraktListKind.Movies),
            TraktContent.Shows => (entry.Show, TraktListKind.Shows),
            _ => entry.Movie is not null ? (entry.Movie, TraktListKind.Movies) : (entry.Show, TraktListKind.Shows),
        };
        return title is null
            ? null
            : new TraktTitle(
                title.Title,
                title.Year is > 0 ? title.Year : null,
                title.Ids?.Tmdb is > 0 ? title.Ids.Tmdb : null,
                ValidImdbId(title.Ids?.Imdb),
                kind);
    }

    /// <summary>An IMDb id ("tt" and digits), or null for anything else.</summary>
    private static string? ValidImdbId(string? id) =>
        id is { Length: > 2 and <= 16 } && id.StartsWith("tt", StringComparison.Ordinal) && id.AsSpan(2).IndexOfAnyExceptInRange('0', '9') < 0 ? id : null;

    /// <summary>
    /// What went wrong. Trakt answers a private list's address as it would a missing one (401, 403 or 404, depending), so
    /// a user's list says either; a chart (always there) can only be refused for the key.
    /// </summary>
    private static string Describe(HttpStatusCode status, bool userList) => status switch
    {
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound when userList =>
            string.Create(CultureInfo.InvariantCulture, $"The list is private or doesn't exist (HTTP {(int)status})."),
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "Trakt rejected the API key. Use the Client ID of an app from trakt.tv/oauth/applications.",
        HttpStatusCode.TooManyRequests => "Trakt asked Lumen to slow down (HTTP 429).",
        >= HttpStatusCode.MultipleChoices and < HttpStatusCode.BadRequest => "Trakt's address redirected somewhere else.",
        _ => string.Create(CultureInfo.InvariantCulture, $"Trakt returned HTTP {(int)status}."),
    };

    /// <summary>One GET: the body, and Trakt's page count when it sends one.</summary>
    private async Task<(T? Body, int? PageCount)> GetAsync<T>(string clientId, string path, bool userList, CancellationToken cancellationToken)
        where T : class
    {
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
                throw new TraktException(Describe(response.StatusCode, userList)) { Status = response.StatusCode };
            }

            if (response.Content.Headers.ContentLength > MaxResponseBytes)
            {
                throw new TraktException("Trakt's answer was too big to be a list.");
            }

            var pageCount = response.Headers.TryGetValues("X-Pagination-Page-Count", out var values)
                && int.TryParse(values.FirstOrDefault(), NumberStyles.None, CultureInfo.InvariantCulture, out var count)
                ? count
                : (int?)null;
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
            var body = await JsonSerializer.DeserializeAsync<T>(stream, Json, timeout.Token).ConfigureAwait(false);
            return (body, pageCount);
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

    private sealed class ListBody
    {
        [JsonPropertyName("name")]
        public string? Name { get; set; }
    }
}
