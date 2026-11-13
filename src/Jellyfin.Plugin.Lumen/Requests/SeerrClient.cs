using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>
/// <see cref="ISeerrClient"/> over <see cref="IHttpClientFactory"/>, with a per-call timeout. The named client
/// (<see cref="HttpClientName"/>) never follows redirects (see ServiceRegistrator), so the API key only ever goes to the
/// configured address; a redirect is reported as an error.
/// <para>
/// User-facing calls (and the user lookup behind them) go through a <see cref="SeerrCircuitBreaker"/>, one per endpoint.
/// The admin calls (<see cref="GetStatusAsync"/>, <see cref="GetJellyfinServerAsync"/>, <see cref="GetServicesAsync"/>, <see cref="GetWebhookAsync"/>,
/// <see cref="GetUserByJellyfinIdForAdminAsync"/>) bypass it, so the dashboard's Test connection and Health tab always
/// really try.
/// </para>
/// <para>
/// Discover lists and title summaries are cached in a <see cref="SeerrResponseCache"/>. Seerr answers them in the acting
/// user's language and discover region, so a cached answer is only shared between users whose Seerr settings for those
/// match (learnt from their user lookup); a user whose settings Lumen hasn't seen gets entries of their own.
/// </para>
/// </summary>
public sealed class SeerrClient : ISeerrClient
{
    public const string HttpClientName = "Lumen.Seerr";
    public const int RequestsTake = 20;
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

    /// <summary>More endpoints than this (an admin trying addresses) and the per-endpoint state starts over.</summary>
    private const int MaxEndpoints = 16;

    /// <summary>More users than this and the learnt content scopes start over (users fall back to their own cache entries).</summary>
    private const int MaxScopes = 10_000;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly IHttpClientFactory _http;
    private readonly TimeProvider _time;
    private readonly ILogger<SeerrClient> _logger;
    private readonly ConcurrentDictionary<string, SeerrCircuitBreaker> _breakers = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<(string Endpoint, int User), string> _scopes = new();

    public SeerrClient(IHttpClientFactory http, TimeProvider time, ILogger<SeerrClient> logger)
    {
        _http = http;
        _time = time;
        _logger = logger;
        Cache = new SeerrResponseCache(time);
    }

    internal SeerrResponseCache Cache { get; }

    public async Task<SeerrStatus> GetStatusAsync(SeerrEndpoint endpoint, CancellationToken cancellationToken)
    {
        var status = await SendAsync<StatusBody>(endpoint, HttpMethod.Get, "api/v1/status", null, null, false, cancellationToken).ConfigureAwait(false);
        return new SeerrStatus(status?.Version ?? "unknown");
    }

    public async Task<SeerrJellyfinServer?> GetJellyfinServerAsync(SeerrEndpoint endpoint, CancellationToken cancellationToken)
    {
        var settings = await SendAsync<JellyfinSettingsBody>(endpoint, HttpMethod.Get, "api/v1/settings/jellyfin", null, null, false, cancellationToken).ConfigureAwait(false);
        return string.IsNullOrEmpty(settings?.ServerId) ? null : new SeerrJellyfinServer(settings.Name ?? "Jellyfin", settings.ServerId);
    }

    public async Task<SeerrServices> GetServicesAsync(SeerrEndpoint endpoint, CancellationToken cancellationToken)
    {
        // Each list's entries carry the Radarr or Sonarr API key: only the count is read, and nothing is kept.
        var radarr = SendAsync<JsonArray>(endpoint, HttpMethod.Get, "api/v1/settings/radarr", null, null, false, cancellationToken);
        var sonarr = SendAsync<JsonArray>(endpoint, HttpMethod.Get, "api/v1/settings/sonarr", null, null, false, cancellationToken);
        await Task.WhenAll(radarr, sonarr).ConfigureAwait(false);
        return new SeerrServices((await radarr.ConfigureAwait(false))?.Count ?? 0, (await sonarr.ConfigureAwait(false))?.Count ?? 0);
    }

    public async Task<SeerrWebhook> GetWebhookAsync(SeerrEndpoint endpoint, CancellationToken cancellationToken)
    {
        var body = await SendAsync<JsonObject>(endpoint, HttpMethod.Get, "api/v1/settings/notifications/webhook", null, null, false, cancellationToken).ConfigureAwait(false);
        var options = body?["options"] as JsonObject;
        static string? Text(JsonNode? node) => node is JsonValue value && value.TryGetValue<string>(out var text) && text.Length > 0 ? text : null;

        // Seerr sends its Authorization Header, or else a custom header of that name.
        var authorization = Text(options?["authHeader"])
            ?? (options?["customHeaders"] as JsonArray)?.OfType<JsonObject>()
                .Where(h => string.Equals(Text(h["key"]), "Authorization", StringComparison.OrdinalIgnoreCase))
                .Select(h => Text(h["value"]))
                .FirstOrDefault();
        var enabled = body?["enabled"] is JsonValue e && e.TryGetValue<bool>(out var on) && on;
        var types = body?["types"] is JsonValue t && t.TryGetValue<int>(out var flags) ? flags : 0;
        return new SeerrWebhook(enabled, types, Text(options?["webhookUrl"]), authorization);
    }

    public Task<SeerrUser?> GetUserByJellyfinIdAsync(SeerrEndpoint endpoint, Guid jellyfinUserId, CancellationToken cancellationToken) =>
        LookUpUserAsync(endpoint, jellyfinUserId, true, cancellationToken);

    public Task<SeerrUser?> GetUserByJellyfinIdForAdminAsync(SeerrEndpoint endpoint, Guid jellyfinUserId, CancellationToken cancellationToken) =>
        LookUpUserAsync(endpoint, jellyfinUserId, false, cancellationToken);

    public async Task<SeerrPage> SearchAsync(SeerrEndpoint endpoint, int seerrUserId, string query, int page, CancellationToken cancellationToken)
    {
        var path = "api/v1/search?query=" + Uri.EscapeDataString(query) + "&page=" + page.ToString(CultureInfo.InvariantCulture);
        return await GetAsync<SeerrPage>(endpoint, path, seerrUserId, cancellationToken).ConfigureAwait(false) ?? throw Unexpected();
    }

    public async Task<SeerrTitle> GetMovieAsync(SeerrEndpoint endpoint, int seerrUserId, int tmdbId, CancellationToken cancellationToken) =>
        await GetAsync<SeerrTitle>(endpoint, "api/v1/movie/" + tmdbId.ToString(CultureInfo.InvariantCulture), seerrUserId, cancellationToken).ConfigureAwait(false)
            ?? throw Unexpected();

    public async Task<SeerrTitle> GetTvAsync(SeerrEndpoint endpoint, int seerrUserId, int tmdbId, CancellationToken cancellationToken) =>
        await GetAsync<SeerrTitle>(endpoint, "api/v1/tv/" + tmdbId.ToString(CultureInfo.InvariantCulture), seerrUserId, cancellationToken).ConfigureAwait(false)
            ?? throw Unexpected();

    public async Task<SeerrPage> GetRecommendationsAsync(SeerrEndpoint endpoint, int seerrUserId, string mediaType, int tmdbId, CancellationToken cancellationToken)
    {
        var path = "api/v1/" + ValidMediaType(mediaType) + "/" + tmdbId.ToString(CultureInfo.InvariantCulture) + "/recommendations?page=1";
        return await GetAsync<SeerrPage>(endpoint, path, seerrUserId, cancellationToken).ConfigureAwait(false) ?? throw Unexpected();
    }

    public async Task<SeerrRequestResult> CreateRequestAsync(
        SeerrEndpoint endpoint, int seerrUserId, string mediaType, int tmdbId, IReadOnlyList<int>? seasons, CancellationToken cancellationToken)
    {
        // Never a userId: acting via X-Api-User is what makes Seerr apply this user's permissions and quota.
        var body = new JsonObject
        {
            ["mediaType"] = ValidMediaType(mediaType),
            ["mediaId"] = tmdbId,
            ["is4k"] = false,
        };
        if (mediaType == CatalogMediaType.Tv)
        {
            body["seasons"] = seasons is { Count: > 0 } ? new JsonArray(seasons.Select(n => (JsonNode)n).ToArray()) : "all";
        }

        var created = await SendAsync<RequestBody>(endpoint, HttpMethod.Post, "api/v1/request", seerrUserId, body, true, cancellationToken).ConfigureAwait(false)
            ?? throw Unexpected();

        // Cached discover lists and summaries carry request states; drop them so rows show the new request.
        Cache.Clear();
        return new SeerrRequestResult(created.Id, created.Status, created.Media?.Status);
    }

    public Task<SeerrPage> DiscoverAsync(SeerrEndpoint endpoint, int seerrUserId, SeerrDiscoverList list, CancellationToken cancellationToken) =>
        DiscoverPageAsync(endpoint, seerrUserId, list, 1, cancellationToken);

    public async Task<SeerrPage> DiscoverPageAsync(SeerrEndpoint endpoint, int seerrUserId, SeerrDiscoverList list, int page, CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(page, 1);
        var resource = list switch
        {
            SeerrDiscoverList.Trending => "api/v1/discover/trending",
            SeerrDiscoverList.PopularMovies => "api/v1/discover/movies",
            SeerrDiscoverList.PopularTv => "api/v1/discover/tv",
            SeerrDiscoverList.UpcomingMovies => "api/v1/discover/movies/upcoming",
            SeerrDiscoverList.UpcomingTv => "api/v1/discover/tv/upcoming",
            _ => throw new ArgumentOutOfRangeException(nameof(list)),
        };
        return await GetCachedAsync<SeerrPage>(endpoint, resource + "?page=" + page.ToString(CultureInfo.InvariantCulture), seerrUserId, cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<SeerrUserRequest>> GetUserRequestsAsync(SeerrEndpoint endpoint, int seerrUserId, CancellationToken cancellationToken, int take = RequestsTake)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(take, 1);

        // Only take and skip: Seerr checks every call against its OpenAPI spec (seerr-api.yml), which defines no other
        // parameter for this route, and answers anything else (a `sort`, which only GET /request has) with a 400. It
        // lists the newest request (highest id) first, but the order is put right here rather than relied on.
        var path = string.Create(CultureInfo.InvariantCulture, $"api/v1/user/{seerrUserId}/requests?take={take}&skip=0");

        // Per user: a 5xx here may be this user's data, so it doesn't pause request features for everyone (see SendAsync).
        var page = await SendAsync<SeerrUserRequestPage>(endpoint, HttpMethod.Get, path, seerrUserId, null, true, cancellationToken, userScoped: true).ConfigureAwait(false) ?? throw Unexpected();
        return (page.Results ?? [])
            .OrderByDescending(r => r.CreatedAt ?? DateTimeOffset.MinValue)
            .ThenByDescending(r => r.Id)
            .ToList();
    }

    public async Task<SeerrTitle> GetTitleSummaryAsync(SeerrEndpoint endpoint, int seerrUserId, string mediaType, int tmdbId, CancellationToken cancellationToken) =>
        await GetCachedAsync<SeerrTitle>(endpoint, "api/v1/" + ValidMediaType(mediaType) + "/" + tmdbId.ToString(CultureInfo.InvariantCulture), seerrUserId, cancellationToken)
            .ConfigureAwait(false);

    /// <summary>The circuit breaker for user-facing calls to <paramref name="endpoint"/>.</summary>
    internal SeerrCircuitBreaker BreakerFor(SeerrEndpoint endpoint)
    {
        var key = endpoint.CacheKey;
        if (_breakers.TryGetValue(key, out var breaker))
        {
            return breaker;
        }

        if (_breakers.Count >= MaxEndpoints)
        {
            _breakers.Clear();
        }

        return _breakers.GetOrAdd(key, _ => new SeerrCircuitBreaker(_time, _logger));
    }

    /// <summary>
    /// Which users may share cached discover lists and title summaries: those whose Seerr language and region settings
    /// are the same. A user Lumen hasn't looked up (or whose settings Seerr didn't include) gets a scope of their own.
    /// </summary>
    internal string ContentScope(SeerrEndpoint endpoint, int seerrUserId) =>
        _scopes.TryGetValue((endpoint.CacheKey, seerrUserId), out var scope)
            ? scope
            : "user:" + seerrUserId.ToString(CultureInfo.InvariantCulture);

    /// <summary>
    /// The user settings that change what Seerr's discover and title responses contain, as a cache scope; null when the
    /// user object has no settings (then the user is not shared with anyone).
    /// </summary>
    private static string? ScopeOf(JsonElement? settings)
    {
        if (settings is not { ValueKind: JsonValueKind.Object } value)
        {
            return null;
        }

        string Read(string name) => value.TryGetProperty(name, out var field) && field.ValueKind != JsonValueKind.Null ? field.GetRawText() : string.Empty;
        return string.Join('|', "locale:" + Read("locale"), "region:" + Read("region"), "discover:" + Read("discoverRegion"), "original:" + Read("originalLanguage"));
    }

    private static string ValidMediaType(string mediaType) =>
        CatalogMediaType.IsValid(mediaType) ? mediaType : throw new ArgumentException("Unknown media type.", nameof(mediaType));

    private static SeerrException Unexpected() => new("Seerr returned an empty response.");

    /// <summary>The <c>message</c> of a Seerr error body, or null. Bounded, since it is shown to users.</summary>
    private static async Task<string?> ReadMessageAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (text.Length > 65536)
            {
                return null;
            }

            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty("message", out var message)
                && message.ValueKind == JsonValueKind.String
                && message.GetString()?.Trim() is { Length: > 0 } value)
            {
                return value.Length > 300 ? value[..300] : value;
            }
        }
        catch (JsonException)
        {
            // Not JSON: no message to pass on.
        }

        return null;
    }

    /// <summary>Seerr's message without the API key, should it ever echo it (the message is logged and shown to users).</summary>
    private static string? Redact(string? message, string apiKey) =>
        message is null || apiKey.Length == 0 ? message : message.Replace(apiKey, "[API key]", StringComparison.Ordinal);

    private static string Describe(HttpStatusCode status) => status switch
    {
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "Seerr rejected the API key.",
        HttpStatusCode.NotFound => "Seerr returned 404. Is this Seerr's address?",
        >= HttpStatusCode.MultipleChoices and < HttpStatusCode.BadRequest =>
            "Seerr's address redirected somewhere else (often a login page in front of Seerr). Use Seerr's direct address, like http://seerr:5055.",
        _ => string.Create(CultureInfo.InvariantCulture, $"Seerr returned HTTP {(int)status}."),
    };

    /// <summary>Whether a failed call counts against the breaker: Seerr unreachable, too slow, a 5xx, or not JSON.</summary>
    private static bool IsOutage(SeerrException e) => e.Status is null || (int)e.Status >= 500;

    /// <summary>
    /// Whether a failed per-user call counts against the breaker: Seerr unreachable or too slow, or a proxy in front of it
    /// saying so (502, 503, 504), none of which a user's data causes. Another 5xx or an answer Lumen can't read may be
    /// down to that one user's requests.
    /// </summary>
    private static bool IsUserScopedOutage(SeerrException e) =>
        e.Status is null
            ? e.InnerException is not JsonException
            : e.Status is HttpStatusCode.BadGateway or HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout;

    private async Task<SeerrUser?> LookUpUserAsync(SeerrEndpoint endpoint, Guid jellyfinUserId, bool guarded, CancellationToken cancellationToken)
    {
        var path = "api/v1/user/jellyfin/" + jellyfinUserId.ToString("N", CultureInfo.InvariantCulture);
        UserBody? user;
        try
        {
            user = await SendAsync<UserBody>(endpoint, HttpMethod.Get, path, null, null, guarded, cancellationToken).ConfigureAwait(false);
        }
        catch (SeerrException e) when (e.Status == HttpStatusCode.NotFound)
        {
            return null;
        }

        if (user is not { Id: > 0 })
        {
            return null;
        }

        RememberScope(endpoint, user.Id, ScopeOf(user.Settings));
        return new SeerrUser(user.Id, user.Permissions);
    }

    private void RememberScope(SeerrEndpoint endpoint, int seerrUserId, string? scope)
    {
        var key = (endpoint.CacheKey, seerrUserId);
        if (scope is null)
        {
            _scopes.TryRemove(key, out _);
            return;
        }

        if (_scopes.Count >= MaxScopes)
        {
            _scopes.Clear();
        }

        _scopes[key] = scope;
    }

    private Task<T?> GetAsync<T>(SeerrEndpoint endpoint, string path, int? actAsUser, CancellationToken cancellationToken) =>
        SendAsync<T>(endpoint, HttpMethod.Get, path, actAsUser, null, true, cancellationToken);

    /// <summary>A GET whose (non-null) result is shared, for <see cref="SeerrResponseCache.Ttl"/>, by users in the same <see cref="ContentScope"/>.</summary>
    private async Task<T> GetCachedAsync<T>(SeerrEndpoint endpoint, string path, int actAsUser, CancellationToken cancellationToken)
        where T : class
    {
        var key = endpoint.CacheKey + "|" + ContentScope(endpoint, actAsUser) + "|" + path;
        if (Cache.TryGet<T>(key, out var cached))
        {
            return cached;
        }

        var value = await GetAsync<T>(endpoint, path, actAsUser, cancellationToken).ConfigureAwait(false) ?? throw Unexpected();
        Cache.Set(key, value);
        return value;
    }

    /// <summary>
    /// One Seerr call, through the endpoint's breaker when <paramref name="guarded"/>. A <paramref name="userScoped"/> call
    /// (one user's own data) counts against the breaker only when Seerr is unreachable or too slow; another failure is
    /// left out of the count, neither failure nor success, since a proxy's 502 for a down Seerr shouldn't close it either.
    /// Error statuses (and 202 to a POST, Seerr's "nothing to request") become a <see cref="SeerrException"/> carrying
    /// Seerr's <c>message</c>.
    /// </summary>
    private async Task<T?> SendAsync<T>(SeerrEndpoint endpoint, HttpMethod method, string path, int? actAsUser, JsonNode? body, bool guarded, CancellationToken cancellationToken, bool userScoped = false)
    {
        if (!guarded)
        {
            return await SendCoreAsync<T>(endpoint, method, path, actAsUser, body, cancellationToken).ConfigureAwait(false);
        }

        var breaker = BreakerFor(endpoint);
        if (breaker.TryEnter() is not { } generation)
        {
            throw new SeerrException("Seerr is temporarily unavailable.") { IsCircuitOpen = true };
        }

        var reported = false;
        try
        {
            var result = await SendCoreAsync<T>(endpoint, method, path, actAsUser, body, cancellationToken).ConfigureAwait(false);
            breaker.RecordSuccess(generation);
            reported = true;
            return result;
        }
        catch (SeerrException e) when (userScoped ? IsUserScopedOutage(e) : IsOutage(e))
        {
            breaker.RecordFailure(generation);
            reported = true;
            throw;
        }
        catch (SeerrException e) when (userScoped && IsOutage(e))
        {
            // Left to the finally's Abandon: says nothing either way about Seerr as a whole.
            throw;
        }
        catch (SeerrException)
        {
            // Seerr answered (a 3xx or 4xx): it's up.
            breaker.RecordSuccess(generation);
            reported = true;
            throw;
        }
        finally
        {
            if (!reported)
            {
                breaker.Abandon(generation);
            }
        }
    }

    private async Task<T?> SendCoreAsync<T>(SeerrEndpoint endpoint, HttpMethod method, string path, int? actAsUser, JsonNode? body, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        using var request = new HttpRequestMessage(method, new Uri(endpoint.BaseUrl, path));
        if (body is not null)
        {
            request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        }

        request.Headers.Add("X-Api-Key", endpoint.ApiKey);
        if (actAsUser is { } userId)
        {
            // Seerr then treats the call as this user, so their permissions and quotas apply.
            request.Headers.Add("X-Api-User", userId.ToString(CultureInfo.InvariantCulture));
        }

        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        try
        {
            var client = _http.CreateClient(HttpClientName);
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode || (method == HttpMethod.Post && response.StatusCode == HttpStatusCode.Accepted))
            {
                var message = Redact(await ReadMessageAsync(response, timeout.Token).ConfigureAwait(false), endpoint.ApiKey);
                throw new SeerrException(Describe(response.StatusCode), response.StatusCode, null, message);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
            return await JsonSerializer.DeserializeAsync<T>(stream, Json, timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException e) when (!cancellationToken.IsCancellationRequested)
        {
            throw new SeerrException("Seerr did not answer within 5 seconds.", null, e);
        }
        catch (HttpRequestException e)
        {
            throw new SeerrException("Couldn't reach Seerr: " + e.Message, null, e);
        }
        catch (JsonException e)
        {
            throw new SeerrException("Seerr returned something Lumen doesn't understand. Is this Seerr's address?", null, e);
        }
    }

    private sealed class StatusBody
    {
        [JsonPropertyName("version")]
        public string? Version { get; set; }
    }

    private sealed class JellyfinSettingsBody
    {
        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("serverId")]
        public string? ServerId { get; set; }
    }

    private sealed class RequestBody
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("status")]
        public int? Status { get; set; }

        [JsonPropertyName("media")]
        public MediaBody? Media { get; set; }
    }

    private sealed class MediaBody
    {
        [JsonPropertyName("status")]
        public int? Status { get; set; }
    }

    private sealed class UserBody
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("permissions")]
        public long Permissions { get; set; }

        /// <summary>Read loosely (see <see cref="ScopeOf"/>): its shape varies between Seerr versions.</summary>
        [JsonPropertyName("settings")]
        public JsonElement? Settings { get; set; }
    }
}
