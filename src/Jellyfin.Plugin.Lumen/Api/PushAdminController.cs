using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Push;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Admin-only: how push notifications are doing, and replacing their keys (the dashboard's Requests card).</summary>
[ApiController]
[Route("Lumen/Admin/Push")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class PushAdminController : ControllerBase
{
    private readonly ILumenConfigStore _config;
    private readonly IPushSubscriptionStore _subscriptions;
    private readonly IPushSender _sender;
    private readonly ReadyPushSignal _signal;

    public PushAdminController(ILumenConfigStore config, IPushSubscriptionStore subscriptions, IPushSender sender, ReadyPushSignal signal)
    {
        _config = config;
        _subscriptions = subscriptions;
        _sender = sender;
        _signal = signal;
    }

    /// <summary>
    /// How many devices have notifications on, how the last one sent went, and what Seerr's webhook needs. The keys are
    /// made here at the latest, but only once Seerr is set up: a server without requests never gets any.
    /// </summary>
    [HttpGet]
    public ActionResult<PushAdminStatusDto> GetStatus() => Status();

    /// <summary>
    /// Replaces Web Push's keys and the webhook secret, and removes every subscription: they were made with the old
    /// public key and can't be sent to any more. Each device subscribes again the next time it opens Lumen.
    /// </summary>
    [HttpPost("ResetKeys")]
    public ActionResult<PushAdminStatusDto> ResetKeys()
    {
        _config.ResetPushSecrets();
        _subscriptions.Clear();
        return Status();
    }

    private PushAdminStatusDto Status()
    {
        var (devices, users) = _subscriptions.Count();
        var secret = SeerrEndpoint.From(_config.Current) is null ? null : _config.GetPushSecrets().WebhookSecret;
        return new PushAdminStatusDto(devices, users, _signal.Running, _sender.Last, "Lumen/Push/Seerr", secret);
    }
}

/// <summary>
/// Response of GET /Lumen/Admin/Push. <c>WebhookPath</c> is relative to the server's address; <c>WebhookSecret</c> is
/// null while Seerr isn't set up. Web Push's private key is never part of it.
/// </summary>
public sealed record PushAdminStatusDto(int Devices, int Users, bool Running, PushSendReport? LastSend, string WebhookPath, string? WebhookSecret);
