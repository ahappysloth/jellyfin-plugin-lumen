using System.Globalization;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>
/// How often the push job (<see cref="ReadyPushJob"/>) looks, and how long it waits before sending a device a
/// notification again.
/// </summary>
/// <param name="Interval">Between two regular passes.</param>
/// <param name="RetryDelay">
/// After a failed send, before the second attempt; doubled before each one after. Never shorter than a pass apart on a
/// real server, however often the job is woken.
/// </param>
public sealed record ReadyPushTimings(TimeSpan Interval, TimeSpan RetryDelay)
{
    /// <summary>
    /// Set <c>LUMEN_PUSH_TEST_PASS_SECONDS</c> to the seconds between two passes, on the E2E tests' server only: an hour
    /// there, so a pass can't send what a test expects of Seerr's webhook or of an open page.
    /// </summary>
    public const string TestPassVariable = "LUMEN_PUSH_TEST_PASS_SECONDS";

    /// <summary>
    /// Set <c>LUMEN_PUSH_TEST_RETRY_SECONDS</c> to the seconds before a failed send's second attempt, on the E2E tests'
    /// server only: a test can't wait the minutes a real server gives a push service.
    /// </summary>
    public const string TestRetryVariable = "LUMEN_PUSH_TEST_RETRY_SECONDS";

    /// <summary>Gets a real server's: a pass every two minutes, and a failed send tried again no sooner than that.</summary>
    public static ReadyPushTimings Default { get; } = new(TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(2));

    /// <summary><see cref="Default"/>, but for what the tests' variables say (a real server never sets them).</summary>
    public static ReadyPushTimings FromEnvironment() => From(
        Environment.GetEnvironmentVariable(TestPassVariable),
        Environment.GetEnvironmentVariable(TestRetryVariable));

    internal static ReadyPushTimings From(string? passSeconds, string? retrySeconds) => new(
        Seconds(passSeconds) ?? Default.Interval,
        Seconds(retrySeconds) ?? Default.RetryDelay);

    private static TimeSpan? Seconds(string? value) =>
        double.TryParse(value, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var seconds) && seconds is >= 0.1 and <= 86400
            ? TimeSpan.FromSeconds(seconds)
            : null;
}
