using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>Sends a notification to a user's devices.</summary>
public interface IPushSender
{
    /// <summary>Gets the last send's result, or null if nothing was sent since Jellyfin started.</summary>
    PushSendReport? Last { get; }

    /// <summary>
    /// Sends to every device the user turned notifications on in (or only <paramref name="deviceId"/>), each with the
    /// message made for it, and removes the subscriptions that are gone.
    /// </summary>
    Task<PushSendResult> SendAsync(Guid userId, Func<PushSubscription, PushMessage> message, TimeSpan timeToLive, CancellationToken cancellationToken, string? deviceId = null);
}

/// <summary>How one notification went, over the user's devices.</summary>
public sealed record PushSendResult(int Sent, int Gone, int Rejected, int Failed, int? Status = null)
{
    /// <summary>Gets a value indicating whether at least one device's push service took it.</summary>
    public bool Delivered => Sent > 0;
}

/// <summary>The last notification sent, for the admin page: what kind, when, and how it went.</summary>
public sealed record PushSendReport(DateTimeOffset At, string Kind, int Sent, int Gone, int Rejected, int Failed, int? Status);

/// <summary>
/// Default <see cref="IPushSender"/>. A subscription the push service says is gone (404, 410) is removed at once; one it
/// refuses <see cref="MaxRejections"/> times in a row (403 after Web Push's keys were lost, say) is removed too, so a
/// device that can never be reached doesn't keep its user from getting the in-app pop-up instead. The device subscribes
/// again by itself the next time it opens Lumen (client/src/views/push/push.ts). A device the user has signed out of
/// is removed before anything is sent to it (<see cref="ISignedInDevices"/>).
/// </summary>
public sealed class PushSender : IPushSender
{
    public const int MaxRejections = 3;

    private readonly ConcurrentDictionary<string, int> _rejections = new(StringComparer.Ordinal);
    private readonly IPushSubscriptionStore _subscriptions;
    private readonly IWebPushClient _client;
    private readonly ISignedInDevices _signedIn;
    private readonly TimeProvider _time;
    private readonly ILogger<PushSender> _logger;
    private volatile PushSendReport? _last;

    public PushSender(IPushSubscriptionStore subscriptions, IWebPushClient client, ISignedInDevices signedIn, TimeProvider time, ILogger<PushSender> logger)
    {
        _subscriptions = subscriptions;
        _client = client;
        _signedIn = signedIn;
        _time = time;
        _logger = logger;
    }

    public PushSendReport? Last => _last;

    public async Task<PushSendResult> SendAsync(Guid userId, Func<PushSubscription, PushMessage> message, TimeSpan timeToLive, CancellationToken cancellationToken, string? deviceId = null)
    {
        var devices = new List<PushSubscription>();
        foreach (var device in _subscriptions.ForUser(userId).Where(s => deviceId is null || s.DeviceId == deviceId))
        {
            // Signed out there since: its notifications end with the session, and it's told nothing more.
            if (_signedIn.IsSignedIn(userId, device.DeviceId))
            {
                devices.Add(device);
            }
            else
            {
                _subscriptions.RemoveEndpoint(userId, device.Endpoint);
            }
        }

        if (devices.Count == 0)
        {
            return new PushSendResult(0, 0, 0, 0);
        }

        string kind = PushMessage.ReadyKind;
        var results = await Task.WhenAll(devices.Select(async device =>
        {
            var made = message(device);
            kind = made.Kind;
            return await _client.SendAsync(device, made.ToPayload(), timeToLive, cancellationToken).ConfigureAwait(false);
        })).ConfigureAwait(false);

        for (var i = 0; i < devices.Count; i++)
        {
            var endpoint = devices[i].Endpoint;
            var remove = false;
            switch (results[i].Outcome)
            {
                case PushOutcome.Sent:
                    _rejections.TryRemove(endpoint, out _);
                    break;
                case PushOutcome.Gone:
                    remove = true;
                    break;
                case PushOutcome.Rejected:
                    remove = _rejections.AddOrUpdate(endpoint, 1, (_, n) => n + 1) >= MaxRejections;
                    break;
            }

            if (remove)
            {
                _rejections.TryRemove(endpoint, out _);
                _subscriptions.RemoveEndpoint(userId, endpoint);
                if (_logger.IsEnabled(LogLevel.Information))
                {
                    _logger.LogInformation(
                        "Lumen removed a notification subscription at {Host}: the push service answered {Status}",
                        PushSubscription.EndpointHost(endpoint),
                        results[i].Status);
                }
            }
        }

        int Count(PushOutcome outcome) => results.Count(r => r.Outcome == outcome);
        var result = new PushSendResult(
            Count(PushOutcome.Sent),
            Count(PushOutcome.Gone),
            Count(PushOutcome.Rejected),
            Count(PushOutcome.Failed),
            results.FirstOrDefault(r => r.Outcome != PushOutcome.Sent)?.Status);
        _last = new PushSendReport(_time.GetUtcNow(), kind, result.Sent, result.Gone, result.Rejected, result.Failed, result.Status);
        if (!result.Delivered)
        {
            // No address or key in the log: the host and the status say enough.
            _logger.LogWarning(
                "Lumen couldn't send a notification ({Kind}) to any of a user's {Count} devices (last status {Status})",
                kind,
                devices.Count,
                result.Status);
        }

        return result;
    }
}
