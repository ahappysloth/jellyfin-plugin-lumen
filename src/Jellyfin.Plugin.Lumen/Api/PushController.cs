using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Push;
using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>
/// Push notifications for the signed-in user's own devices (web push design note, 2026-11-12): whether they're on for
/// this device, turning them on and off, and a test. A subscription belongs to the Jellyfin user the request is signed
/// in as and the device its access token was issued to (<see cref="ISignedInDevices.ForToken"/>), never to what the
/// request itself says: nobody can read, replace or remove another user's, nor one session another device's. Also
/// Lumen's service worker, and Seerr's webhook.
/// </summary>
[ApiController]
[Route("Lumen/Push")]
[Authorize]
public sealed class PushController : ControllerBase
{
    /// <summary>The service worker's file among the embedded client files (client/src/views/push/pushWorker.js).</summary>
    public const string WorkerAsset = "lumen-push-sw.js";

    /// <summary>How long a push service keeps a test for a device that's off: it's only of use right now.</summary>
    public static readonly TimeSpan TestTimeToLive = TimeSpan.FromMinutes(1);

    /// <summary>The largest webhook body read (Seerr's are a few hundred bytes).</summary>
    private const int MaxWebhookBytes = 64 * 1024;

    private readonly AssetCatalog _assets;
    private readonly ISeerrUserMap _users;
    private readonly ILumenConfigStore _config;
    private readonly IPushSubscriptionStore _subscriptions;
    private readonly IPushSender _sender;
    private readonly PushTestLimiter _limiter;
    private readonly PushSubscribeLimiter _subscribeLimiter;
    private readonly ISignedInDevices _devices;
    private readonly ReadyPushSignal _signal;
    private readonly TimeProvider _time;
    private readonly ILogger<PushController> _logger;

    public PushController(
        AssetCatalog assets,
        ISeerrUserMap users,
        ILumenConfigStore config,
        IPushSubscriptionStore subscriptions,
        IPushSender sender,
        PushTestLimiter limiter,
        PushSubscribeLimiter subscribeLimiter,
        ISignedInDevices devices,
        ReadyPushSignal signal,
        TimeProvider time,
        ILogger<PushController> logger)
    {
        _assets = assets;
        _users = users;
        _config = config;
        _subscriptions = subscriptions;
        _sender = sender;
        _limiter = limiter;
        _subscribeLimiter = subscribeLimiter;
        _devices = devices;
        _signal = signal;
        _time = time;
        _logger = logger;
    }

    /// <summary>
    /// Lumen's service worker, which shows the notifications. Served from here, not with the other client files, so its
    /// scope is <c>/Lumen/Push/</c>: it controls no page and leaves jellyfin-web's own worker (scope <c>/web/</c>) alone.
    /// Anonymous, as browsers fetch a worker (and check it for updates) without the user's token; never cached, so an
    /// update of Lumen reaches it.
    /// </summary>
    [HttpGet("sw.js")]
    [AllowAnonymous]
    public IActionResult GetWorker()
    {
        if (!_assets.TryGet(WorkerAsset, out var asset))
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "no-cache";
        return File(asset.Content, asset.ContentType);
    }

    /// <summary>
    /// Whether this user can have notifications (request features, as for My requests), the key a browser subscribes
    /// with, and the push address stored for this device, if any (the client compares it with the browser's own).
    /// </summary>
    [HttpGet("Status")]
    public async Task<ActionResult<PushStatusDto>> GetStatus(CancellationToken cancellationToken)
    {
        if (User.GetJellyfinUserId(_logger) is not { } userId)
        {
            return Unauthorized();
        }

        Response.Headers.CacheControl = "no-store";
        var mine = Device(userId) is { } device ? _subscriptions.ForDevice(userId, device.Id) : null;
        if (!await HasRequestsAsync(userId, cancellationToken).ConfigureAwait(false))
        {
            // The stored address still goes out: a device left subscribed must be able to see that, and turn it off.
            return new PushStatusDto(false, null, mine?.Endpoint);
        }

        return new PushStatusDto(true, _config.GetPushSecrets().Keys.PublicKey, mine?.Endpoint);
    }

    /// <summary>
    /// Turns notifications on for this device: stores the browser's push subscription in place of its last one.
    /// Rate-limited per user (<see cref="PushSubscribeLimiter"/>).
    /// </summary>
    [HttpPost("Subscription")]
    public async Task<ActionResult> Subscribe([FromBody] PushSubscribeDto? body, CancellationToken cancellationToken)
    {
        if (User.GetJellyfinUserId(_logger) is not { } userId)
        {
            return Unauthorized();
        }

        if (Device(userId) is not { Id.Length: <= PushSubscription.MaxDeviceIdLength } device)
        {
            return BadRequest(new ErrorDto("This sign-in has no device id."));
        }

        if (body is null || !PushSubscription.AreValidKeys(body.P256dh, body.Auth))
        {
            return BadRequest(new ErrorDto("Invalid subscription."));
        }

        if (!PushSubscription.IsAllowedEndpoint(body.Endpoint, Environment.GetEnvironmentVariable(PushSubscription.TestEndpointVariable)))
        {
            return BadRequest(new ErrorDto("This browser's push service isn't supported."));
        }

        if (!await HasRequestsAsync(userId, cancellationToken).ConfigureAwait(false))
        {
            return NotFound();
        }

        // Last, so only what would be stored counts: each one is a write to the disk.
        if (!_subscribeLimiter.TryAcquire(userId, out var retryAfter))
        {
            Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds).ToString(CultureInfo.InvariantCulture);
            return StatusCode(StatusCodes.Status429TooManyRequests, new ErrorDto("Wait a moment before turning notifications on again."));
        }

        _subscriptions.Save(userId, new PushSubscription(body.Endpoint!, body.P256dh!, body.Auth!, device.Id, Clip(device.Name, 100), _time.GetUtcNow()));
        return NoContent();
    }

    /// <summary>
    /// Turns notifications off for this device. Always allowed, with or without request features, and fine to repeat.
    /// </summary>
    [HttpDelete("Subscription")]
    public ActionResult Unsubscribe()
    {
        if (User.GetJellyfinUserId(_logger) is not { } userId)
        {
            return Unauthorized();
        }

        if (Device(userId) is { } device)
        {
            _subscriptions.Remove(userId, device.Id);
        }

        return NoContent();
    }

    /// <summary>Sends this device a test notification. Rate-limited per user (<see cref="PushTestLimiter"/>).</summary>
    [HttpPost("Test")]
    public async Task<ActionResult<PushTestResultDto>> SendTest(CancellationToken cancellationToken)
    {
        if (User.GetJellyfinUserId(_logger) is not { } userId)
        {
            return Unauthorized();
        }

        if (Device(userId) is not { } device || _subscriptions.ForDevice(userId, device.Id) is null)
        {
            return NotFound();
        }

        if (!_limiter.TryAcquire(userId, out var retryAfter))
        {
            Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds).ToString(CultureInfo.InvariantCulture);
            return StatusCode(StatusCodes.Status429TooManyRequests, new ErrorDto("Wait a moment before sending another test."));
        }

        var result = await _sender.SendAsync(userId, PushMessage.Test(), TestTimeToLive, cancellationToken, [device.Id]).ConfigureAwait(false);
        var error = result switch
        {
            { Delivered: true } => null,
            { Gone: > 0 } => PushTestResultDto.Gone,
            { Rejected: > 0 } => PushTestResultDto.Rejected,
            _ => PushTestResultDto.Unreachable,
        };
        return new PushTestResultDto(result.Delivered, error);
    }

    /// <summary>
    /// Seerr's webhook (Settings → Notifications → Webhook, with "Request Available" ticked): something became
    /// available, so check now instead of at the next pass. Not signed in as anyone: Seerr proves itself with the secret
    /// from Lumen's settings, as its Authorization Header. The body only says which request; what's ready, and for
    /// whom, is still read from Seerr itself, so a forged call could at most make Lumen look early. A body over
    /// <see cref="MaxWebhookBytes"/> is answered 413, and a call Lumen has no room to act on 503, for Seerr to repeat.
    /// </summary>
    [HttpPost("Seerr")]
    [AllowAnonymous]
    [RequestSizeLimit(MaxWebhookBytes)]
    public async Task<ActionResult> SeerrWebhook(CancellationToken cancellationToken)
    {
        var config = _config.Current;
        if (!IsWebhookSecret(Request.Headers.Authorization.ToString(), config.PushWebhookSecret))
        {
            return Unauthorized();
        }

        if (await ReadWebhookAsync(cancellationToken).ConfigureAwait(false) is not { } json)
        {
            return StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        string? type = null;
        int? requestId = null;
        try
        {
            using var body = JsonDocument.Parse(json);
            if (body.RootElement.ValueKind == JsonValueKind.Object)
            {
                type = body.RootElement.TryGetProperty("notification_type", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;

                // Seerr's template writes every value as a string: "request_id": "12".
                if (body.RootElement.TryGetProperty("request", out var request)
                    && request.ValueKind == JsonValueKind.Object
                    && request.TryGetProperty("request_id", out var id))
                {
                    requestId = id.ValueKind switch
                    {
                        JsonValueKind.Number when id.TryGetInt32(out var n) => n,
                        JsonValueKind.String when int.TryParse(id.GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out var n) => n,
                        _ => null,
                    };
                }
            }
        }
        catch (JsonException)
        {
            return BadRequest();
        }

        // Seerr's "Test" button, and any other notification type the admin ticked: fine, and nothing to do.
        if (string.Equals(type, "MEDIA_AVAILABLE", StringComparison.Ordinal) && !_signal.WakeAll(requestId is > 0 ? requestId : null))
        {
            // Too much is waiting already (ReadyPushSignal logs it, once): not taken, and said so, never dropped
            // behind a 204. No regular pass would announce a request only this call names.
            Response.Headers.RetryAfter = "30";
            return StatusCode(StatusCodes.Status503ServiceUnavailable);
        }

        return NoContent();
    }

    /// <summary>Whether <paramref name="header"/> is the secret, bare or as <c>Bearer &lt;secret&gt;</c>, compared in constant time.</summary>
    internal static bool IsWebhookSecret(string? header, string? secret)
    {
        if (string.IsNullOrEmpty(secret) || string.IsNullOrEmpty(header))
        {
            return false;
        }

        var given = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : header.Trim();
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(given), Encoding.UTF8.GetBytes(secret));
    }

    private static string? Clip(string? value, int max) => value is { Length: > 0 } ? (value.Length <= max ? value : value[..max]) : null;

    /// <summary>
    /// The device this request is signed in from: the one its access token was issued to. The device the request's
    /// own header names (Jellyfin's device id claim) only stands in when Jellyfin's device list can't be read.
    /// </summary>
    private SessionDevice? Device(Guid userId) => _devices.ForToken(
        userId,
        User.GetJellyfinToken(),
        User.GetJellyfinDeviceId() is { } claimed ? new SessionDevice(claimed, User.GetJellyfinDeviceName()) : null);

    /// <summary>
    /// The webhook's body, or null when it's longer than <see cref="MaxWebhookBytes"/>: by what the request says of its
    /// length, by what arrives, or by the server's own limit (which throws as the body is read, and would be a 500).
    /// </summary>
    private async Task<byte[]?> ReadWebhookAsync(CancellationToken cancellationToken)
    {
        if (Request.ContentLength > MaxWebhookBytes)
        {
            return null;
        }

        try
        {
            using var body = new MemoryStream();
            var buffer = new byte[8192];
            int read;
            while ((read = await Request.Body.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) > 0)
            {
                if (body.Length + read > MaxWebhookBytes)
                {
                    return null;
                }

                body.Write(buffer, 0, read);
            }

            return body.ToArray();
        }
        catch (BadHttpRequestException e) when (e.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            return null;
        }
    }

    /// <summary>Whether the user has request features (Seerr set up, and an account there): what notifications are about.</summary>
    private async Task<bool> HasRequestsAsync(Guid userId, CancellationToken cancellationToken)
    {
        var access = await _users.GetAccessAsync(userId, cancellationToken).ConfigureAwait(false);
        return access.Enabled && access.SeerrUserId is not null && access.Endpoint is not null;
    }
}

/// <summary>
/// Response of GET /Lumen/Push/Status. <c>PublicKey</c> is Web Push's public key (base64url), null without request
/// features; <c>Endpoint</c> is the push address stored for this device, or null.
/// </summary>
public sealed record PushStatusDto(bool Available, string? PublicKey, string? Endpoint);

/// <summary>Body of POST /Lumen/Push/Subscription: a browser's <c>PushSubscription</c>.</summary>
public sealed record PushSubscribeDto(string? Endpoint, string? P256dh, string? Auth);

/// <summary>Result of POST /Lumen/Push/Test: whether the push service took it, or what to tell the user.</summary>
public sealed record PushTestResultDto(bool Ok, string? Error)
{
    // Gone: the server has dropped the subscription, so the switch shows off, and turning it on makes a new one.
    internal const string Gone = "This device's notifications had expired and were turned off. Turn them on again.";
    internal const string Rejected = "The push service refused the notification. Turn notifications off and on again.";
    internal const string Unreachable = "The server couldn't reach the push service. Try again later.";
}
