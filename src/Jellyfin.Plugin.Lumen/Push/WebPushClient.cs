using System.Buffers.Text;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using Jellyfin.Plugin.Lumen.Configuration;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>What a push service did with one message.</summary>
public enum PushOutcome
{
    /// <summary>Accepted (201): the push service delivers it when the device is reachable.</summary>
    Sent,

    /// <summary>The subscription no longer exists (404 or 410): the browser unsubscribed or was uninstalled. Remove it.</summary>
    Gone,

    /// <summary>Refused (another 4xx): the message or its signature was wrong for this subscription.</summary>
    Rejected,

    /// <summary>Not delivered this time: the push service was unreachable, too slow, busy (429) or failing (5xx).</summary>
    Failed,
}

/// <summary>Sends one encrypted message to one subscription.</summary>
public interface IWebPushClient
{
    Task<PushResult> SendAsync(PushSubscription subscription, ReadOnlyMemory<byte> payload, TimeSpan timeToLive, CancellationToken cancellationToken);
}

/// <summary>One message's result: <see cref="Status"/> is the push service's HTTP status, when it answered.</summary>
public sealed record PushResult(PushOutcome Outcome, int? Status = null);

/// <summary>
/// The Web Push protocol (RFC 8030): a POST to the subscription's address with the message encrypted for that browser
/// (<see cref="WebPushEncryption"/>) and signed as this server (<see cref="VapidKeys"/>). Never follows a redirect (see
/// ServiceRegistrator), so a message only ever goes to the address the browser gave.
/// </summary>
public sealed class WebPushClient : IWebPushClient
{
    public const string HttpClientName = "LumenPush";

    /// <summary>
    /// The JWT's <c>sub</c>: whom a push service may contact about this sender (RFC 8292 §2.1). A Jellyfin server has no
    /// address of its operator's to give, and Apple refuses a made-up one (like a <c>localhost</c> mail address), so it's
    /// the project's page.
    /// </summary>
    public const string Subject = "https://github.com/ahappysloth/jellyfin-plugin-lumen";

    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    private readonly IHttpClientFactory _http;
    private readonly ILumenConfigStore _config;
    private readonly TimeProvider _time;

    public WebPushClient(IHttpClientFactory http, ILumenConfigStore config, TimeProvider time)
    {
        _http = http;
        _config = config;
        _time = time;
    }

    public async Task<PushResult> SendAsync(PushSubscription subscription, ReadOnlyMemory<byte> payload, TimeSpan timeToLive, CancellationToken cancellationToken)
    {
        byte[] body;
        try
        {
            body = WebPushEncryption.Encrypt(payload.Span, Base64Url.DecodeFromChars(subscription.P256dh), Base64Url.DecodeFromChars(subscription.Auth));
        }
        catch (Exception e) when (e is FormatException or ArgumentException or CryptographicException)
        {
            // Keys no browser sent (the store checks them on the way in): nothing can ever be sent to this one.
            return new PushResult(PushOutcome.Gone);
        }

        var endpoint = new Uri(subscription.Endpoint);
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = new ByteArrayContent(body) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        request.Content.Headers.ContentEncoding.Add("aes128gcm");
        request.Headers.TryAddWithoutValidation("Authorization", _config.GetPushSecrets().Keys.AuthorizationHeader(endpoint, Subject, _time.GetUtcNow()));

        // How long the push service keeps it for a device that's off or offline (RFC 8030 §5.2).
        request.Headers.TryAddWithoutValidation("TTL", ((long)timeToLive.TotalSeconds).ToString(CultureInfo.InvariantCulture));
        request.Headers.TryAddWithoutValidation("Urgency", "normal");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        try
        {
            using var response = await _http.CreateClient(HttpClientName).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
            var status = (int)response.StatusCode;
            return new PushResult(
                response.StatusCode switch
                {
                    _ when response.IsSuccessStatusCode => PushOutcome.Sent,
                    HttpStatusCode.NotFound or HttpStatusCode.Gone => PushOutcome.Gone,
                    HttpStatusCode.TooManyRequests or HttpStatusCode.RequestTimeout => PushOutcome.Failed,
                    _ when status is >= 400 and < 500 => PushOutcome.Rejected,
                    _ => PushOutcome.Failed,
                },
                status);
        }
        catch (Exception e) when (e is HttpRequestException or IOException || (e is OperationCanceledException && !cancellationToken.IsCancellationRequested))
        {
            return new PushResult(PushOutcome.Failed);
        }
    }
}
