using System.Collections.Concurrent;
using Jellyfin.Plugin.Lumen.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>Maps Jellyfin users to their Seerr accounts.</summary>
public interface ISeerrUserMap
{
    Task<RequestAccess> GetAccessAsync(Guid jellyfinUserId, CancellationToken cancellationToken);
}

/// <summary>
/// Caches the Jellyfin → Seerr user mapping: found users for <see cref="HitTtl"/>, unmapped users for
/// <see cref="MissTtl"/> (so a newly imported user shows up soon). Errors are not cached and mean "no access". This is
/// the single gate for every request feature, so with Lumen or requests switched off nobody has access.
/// </summary>
public sealed class SeerrUserMap : ISeerrUserMap
{
    public static readonly TimeSpan HitTtl = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan MissTtl = TimeSpan.FromMinutes(1);

    private readonly ConcurrentDictionary<(Guid User, string Endpoint), (RequestAccess Access, DateTimeOffset Expires)> _cache = new();
    private readonly ILumenConfigReader _config;
    private readonly ISeerrClient _seerr;
    private readonly TimeProvider _time;
    private readonly ILogger<SeerrUserMap> _logger;

    public SeerrUserMap(ILumenConfigReader config, ISeerrClient seerr, TimeProvider time, ILogger<SeerrUserMap> logger)
    {
        _config = config;
        _seerr = seerr;
        _time = time;
        _logger = logger;
    }

    public async Task<RequestAccess> GetAccessAsync(Guid jellyfinUserId, CancellationToken cancellationToken)
    {
        var config = _config.Current;
        if (!config.Enabled || SeerrEndpoint.From(config) is not { } endpoint)
        {
            return RequestAccess.None;
        }

        // Keyed by endpoint too, so changing Seerr's address or key in the dashboard takes effect immediately.
        var key = (jellyfinUserId, endpoint.CacheKey);
        var now = _time.GetUtcNow();
        if (_cache.TryGetValue(key, out var cached) && cached.Expires > now)
        {
            return cached.Access;
        }

        try
        {
            var user = await _seerr.GetUserByJellyfinIdAsync(endpoint, jellyfinUserId, cancellationToken).ConfigureAwait(false);
            var access = user is null
                ? RequestAccess.None
                : new RequestAccess(true, SeerrPermissions.CanRequestMovies(user.Permissions), SeerrPermissions.CanRequestTv(user.Permissions), user.Id, endpoint);
            _cache[key] = (access, now + (user is null ? MissTtl : HitTtl));
            return access;
        }
        catch (SeerrException e) when (e.IsCircuitOpen)
        {
            // Seerr is known to be down (the breaker logged that once); hide request features quietly.
            return RequestAccess.None;
        }
        catch (SeerrException e)
        {
            _logger.LogWarning("Lumen couldn't look up the Seerr account for a user: {Message}", e.Message);
            return RequestAccess.None;
        }
    }
}
