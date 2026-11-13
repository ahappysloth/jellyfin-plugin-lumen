using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>Sends a notification to a user's devices.</summary>
public interface IPushSender
{
    /// <summary>Gets the last send's result, or null if nothing was sent since Jellyfin started.</summary>
    PushSendReport? Last { get; }

    /// <summary>
    /// Sends to every device the user turned notifications on in (or only those of <paramref name="deviceIds"/>), and
    /// removes the subscriptions that are gone. The result says how it went for each device.
    /// </summary>
    Task<PushSendResult> SendAsync(Guid userId, PushMessage message, TimeSpan timeToLive, CancellationToken cancellationToken, IReadOnlyCollection<string>? deviceIds = null);
}

/// <summary>How one notification went for one device. <c>Removed</c>: its subscription was dropped because of it.</summary>
public sealed record PushDeviceResult(string DeviceId, PushOutcome Outcome, int? Status, bool Removed)
{
    /// <summary>Gets a value indicating whether the device is still subscribed and didn't get the message: worth another try.</summary>
    public bool Owed => !Removed && Outcome is PushOutcome.Failed or PushOutcome.Rejected;
}

/// <summary>How one notification went, over the user's devices: the counts, and each device's own result.</summary>
public sealed record PushSendResult(int Sent, int Gone, int Rejected, int Failed, int? Status = null)
{
    /// <summary>Gets a value indicating whether at least one device's push service took it.</summary>
    public bool Delivered => Sent > 0;

    /// <summary>Gets each device's result: one device taking the message says nothing about the others.</summary>
    public IReadOnlyList<PushDeviceResult> Devices { get; init; } = [];
}

/// <summary>The last notification sent, for the admin page: what kind, when, and how it went.</summary>
public sealed record PushSendReport(DateTimeOffset At, string Kind, int Sent, int Gone, int Rejected, int Failed, int? Status);

/// <summary>
/// Default <see cref="IPushSender"/>. A subscription the push service says is gone (404, 410) is removed at once; one it
/// refuses <see cref="MaxRejections"/> times in a row (403 after Web Push's keys were lost, say) is removed too, so a
/// device that can never be reached doesn't keep its user from getting the in-app pop-up instead. The device subscribes
/// again by itself the next time it opens Lumen (client/src/views/push/push.ts). A device the user has signed out of
/// is removed before anything is sent to it (<see cref="ISignedInDevices"/>).
/// <para>
/// A device that can't be reached is logged once, when its trouble starts, not at every attempt: the caller retries
/// (Push/ReadyPushJob), and a push service may be down for hours.
/// </para>
/// </summary>
public sealed class PushSender : IPushSender
{
    public const int MaxRejections = 3;

    /// <summary>Refusals in a row, by push address. Forgotten with the subscription (<see cref="IPushSubscriptionStore.Removed"/>).</summary>
    private readonly ConcurrentDictionary<string, int> _rejections = new(StringComparer.Ordinal);

    /// <summary>The push addresses that couldn't be reached at the last attempt: their trouble has been logged.</summary>
    private readonly ConcurrentDictionary<string, bool> _failing = new(StringComparer.Ordinal);
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

        // Turned off, replaced or dropped: what was counted against the address goes with it.
        _subscriptions.Removed += endpoint =>
        {
            _rejections.TryRemove(endpoint, out _);
            _failing.TryRemove(endpoint, out _);
        };
    }

    public PushSendReport? Last => _last;

    public async Task<PushSendResult> SendAsync(Guid userId, PushMessage message, TimeSpan timeToLive, CancellationToken cancellationToken, IReadOnlyCollection<string>? deviceIds = null)
    {
        var devices = new List<PushSubscription>();
        foreach (var device in _subscriptions.ForUser(userId).Where(s => deviceIds is null || deviceIds.Contains(s.DeviceId)))
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

        var payload = message.ToPayload();
        var results = await Task.WhenAll(devices.Select(device => _client.SendAsync(device, payload, timeToLive, cancellationToken))).ConfigureAwait(false);
        var perDevice = new List<PushDeviceResult>(devices.Count);
        for (var i = 0; i < devices.Count; i++)
        {
            perDevice.Add(new PushDeviceResult(devices[i].DeviceId, results[i].Outcome, results[i].Status, Settle(userId, devices[i].Endpoint, results[i])));
        }

        int Count(PushOutcome outcome) => results.Count(r => r.Outcome == outcome);
        var result = new PushSendResult(
            Count(PushOutcome.Sent),
            Count(PushOutcome.Gone),
            Count(PushOutcome.Rejected),
            Count(PushOutcome.Failed),
            results.FirstOrDefault(r => r.Outcome != PushOutcome.Sent)?.Status)
        {
            Devices = perDevice,
        };
        _last = new PushSendReport(_time.GetUtcNow(), message.Kind, result.Sent, result.Gone, result.Rejected, result.Failed, result.Status);
        return result;
    }

    /// <summary>
    /// What one device's result means for its subscription, and for the log. Never an address or a key there: the push
    /// service's host and its status say enough. Returns whether the subscription was removed.
    /// </summary>
    private bool Settle(Guid userId, string endpoint, PushResult result)
    {
        var remove = false;
        switch (result.Outcome)
        {
            case PushOutcome.Sent:
                _rejections.TryRemove(endpoint, out _);
                if (_failing.TryRemove(endpoint, out _) && _logger.IsEnabled(LogLevel.Information))
                {
                    _logger.LogInformation("Lumen can send notifications through {Host} again", PushSubscription.EndpointHost(endpoint));
                }

                break;
            case PushOutcome.Gone:
                remove = true;
                break;
            case PushOutcome.Rejected:
                var refused = _rejections.AddOrUpdate(endpoint, 1, (_, n) => n + 1);
                remove = refused >= MaxRejections;
                if (refused == 1)
                {
                    _logger.LogWarning(
                        "The push service at {Host} refused a notification for a device (status {Status}). Lumen removes the device's subscription if it refuses {Max} times running.",
                        PushSubscription.EndpointHost(endpoint),
                        result.Status,
                        MaxRejections);
                }

                break;
            case PushOutcome.Failed:
                // Once per device for as long as it lasts: every retry, and every request that's ready meanwhile, would
                // say the same.
                if (_failing.TryAdd(endpoint, true))
                {
                    _logger.LogWarning(
                        "Lumen couldn't send a notification to a device through {Host} (status {Status}). It tries a few more times, then leaves what's ready to the pop-up in the app. Not logged again until that device can be reached.",
                        PushSubscription.EndpointHost(endpoint),
                        result.Status);
                }

                break;
        }

        if (remove)
        {
            // The store's Removed event forgets what was counted against the address.
            _subscriptions.RemoveEndpoint(userId, endpoint);
            if (_logger.IsEnabled(LogLevel.Information))
            {
                _logger.LogInformation(
                    "Lumen removed a notification subscription at {Host}: the push service answered {Status}",
                    PushSubscription.EndpointHost(endpoint),
                    result.Status);
            }
        }

        return remove;
    }
}
