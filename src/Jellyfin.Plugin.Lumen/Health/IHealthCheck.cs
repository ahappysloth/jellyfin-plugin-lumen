namespace Jellyfin.Plugin.Lumen.Health;

/// <summary>
/// One server-side row of the Health tab. To add a check: implement this, register it in
/// <see cref="ServiceRegistrator"/> (the order there is the order on the page within its group), and give the client its
/// group if it's a new one (client/src/admin/health/healthModel.ts). <see cref="HealthService"/> runs every check at once,
/// each with a time limit, so a slow one can't hold up the page.
/// </summary>
public interface IHealthCheck
{
    /// <summary>Gets a stable id (<c>requests.seerr</c>): the page and the copied report key on it.</summary>
    string Id { get; }

    /// <summary>Gets the <see cref="HealthGroup"/> it's shown under.</summary>
    string Group { get; }

    /// <summary>Gets the row's short title, also used when the check can't run.</summary>
    string Title { get; }

    /// <summary>Runs the check.</summary>
    /// <param name="fresh">True for "Run checks again": nothing cached may be reused.</param>
    /// <param name="cancellationToken">Cancelled when the check's time is up.</param>
    /// <returns>The row to show.</returns>
    Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken);
}

/// <summary>Helpers for building a check's result.</summary>
public static class HealthCheckExtensions
{
    public static HealthCheckResult Result(this IHealthCheck check, string status, string message, HealthFix? fix = null)
    {
        ArgumentNullException.ThrowIfNull(check);
        return new HealthCheckResult(check.Id, check.Group, status, check.Title, message, fix);
    }
}
