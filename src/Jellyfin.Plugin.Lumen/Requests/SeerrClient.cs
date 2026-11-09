using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Jellyfin.Plugin.Lumen.Configuration;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Typed access to the Seerr endpoints Lumen uses (see the requests design spec, §4).</summary>
public interface ISeerrClient
{
    Task<SeerrStatus> GetStatusAsync(SeerrEndpoint endpoint, CancellationToken cancellationToken);

    /// <summary>The Jellyfin server Seerr is linked to, or null if it isn't set up for Jellyfin.</summary>
    Task<SeerrJellyfinServer?> GetJellyfinServerAsync(SeerrEndpoint endpoint, CancellationToken cancellationToken);

    /// <summary>The Seerr account linked to a Jellyfin user, or null if there is none.</summary>
    Task<SeerrUser?> GetUserByJellyfinIdAsync(SeerrEndpoint endpoint, Guid jellyfinUserId, CancellationToken cancellationToken);
}

/// <summary>Where and how to reach Seerr: base URL plus the admin API key.</summary>
public sealed record SeerrEndpoint(Uri BaseUrl, string ApiKey)
{
    /// <summary>The configured endpoint, or null when requests are off or not fully configured.</summary>
    public static SeerrEndpoint? From(PluginConfiguration config) =>
        config.RequestsEnabled && ConfigValidator.IsHttpUrl(config.SeerrUrl) && !string.IsNullOrWhiteSpace(config.SeerrApiKey)
            ? new SeerrEndpoint(new Uri(config.SeerrUrl!.TrimEnd('/') + "/"), config.SeerrApiKey!)
            : null;
}

/// <summary>Seerr's version, from <c>GET /api/v1/status</c>.</summary>
public sealed record SeerrStatus(string Version);

/// <summary>
/// The Jellyfin server Seerr is linked to. Seerr's settings response also contains its Jellyfin API key, so only the
/// name and server id are kept.
/// </summary>
public sealed record SeerrJellyfinServer(string Name, string ServerId)
{
    /// <summary>True when <paramref name="systemId"/> (this server's id) is the server Seerr is linked to.</summary>
    public bool Is(string systemId) => Normalize(ServerId) == Normalize(systemId);

    private static string Normalize(string id) => id.Replace("-", string.Empty, StringComparison.Ordinal).ToUpperInvariant();
}

/// <summary>
/// The only parts of a Seerr user Lumen keeps. Seerr's user object (fetched with the admin key) also carries the user's
/// Jellyfin and Plex tokens, so it is never stored or passed on whole.
/// </summary>
public sealed record SeerrUser(int Id, long Permissions);

/// <summary>A Seerr call failed: unreachable, timed out, rejected the key, or returned something unexpected.</summary>
public sealed class SeerrException : Exception
{
    public SeerrException(string message, HttpStatusCode? status = null, Exception? inner = null)
        : base(message, inner)
    {
        Status = status;
    }

    public HttpStatusCode? Status { get; }
}

/// <summary><see cref="ISeerrClient"/> over <see cref="IHttpClientFactory"/>, with a per-call timeout.</summary>
public sealed class SeerrClient : ISeerrClient
{
    public const string HttpClientName = "Lumen.Seerr";
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly IHttpClientFactory _http;

    public SeerrClient(IHttpClientFactory http)
    {
        _http = http;
    }

    public async Task<SeerrStatus> GetStatusAsync(SeerrEndpoint endpoint, CancellationToken cancellationToken)
    {
        var status = await GetAsync<StatusBody>(endpoint, "api/v1/status", null, cancellationToken).ConfigureAwait(false);
        return new SeerrStatus(status?.Version ?? "unknown");
    }

    public async Task<SeerrJellyfinServer?> GetJellyfinServerAsync(SeerrEndpoint endpoint, CancellationToken cancellationToken)
    {
        var settings = await GetAsync<JellyfinSettingsBody>(endpoint, "api/v1/settings/jellyfin", null, cancellationToken).ConfigureAwait(false);
        return string.IsNullOrEmpty(settings?.ServerId) ? null : new SeerrJellyfinServer(settings.Name ?? "Jellyfin", settings.ServerId);
    }

    public async Task<SeerrUser?> GetUserByJellyfinIdAsync(SeerrEndpoint endpoint, Guid jellyfinUserId, CancellationToken cancellationToken)
    {
        var path = "api/v1/user/jellyfin/" + jellyfinUserId.ToString("N", CultureInfo.InvariantCulture);
        try
        {
            var user = await GetAsync<UserBody>(endpoint, path, null, cancellationToken).ConfigureAwait(false);
            return user is { Id: > 0 } ? new SeerrUser(user.Id, user.Permissions) : null;
        }
        catch (SeerrException e) when (e.Status == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    private static string Describe(HttpStatusCode status) => status switch
    {
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "Seerr rejected the API key.",
        HttpStatusCode.NotFound => "Seerr returned 404. Is this Seerr's address?",
        _ => string.Create(CultureInfo.InvariantCulture, $"Seerr returned HTTP {(int)status}."),
    };

    private async Task<T?> GetAsync<T>(SeerrEndpoint endpoint, string path, int? actAsUser, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(endpoint.BaseUrl, path));
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
            if (!response.IsSuccessStatusCode)
            {
                throw new SeerrException(Describe(response.StatusCode), response.StatusCode);
            }

            await using var body = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
            return await JsonSerializer.DeserializeAsync<T>(body, Json, timeout.Token).ConfigureAwait(false);
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

    private sealed class UserBody
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("permissions")]
        public long Permissions { get; set; }
    }
}
