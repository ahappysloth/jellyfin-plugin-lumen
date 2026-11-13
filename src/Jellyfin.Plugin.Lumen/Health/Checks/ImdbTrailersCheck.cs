using System.Globalization;
using System.Net;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;

namespace Jellyfin.Plugin.Lumen.Health.Checks;

/// <summary>
/// Online trailers: with the setting on, one IMDb lookup of a title known to have a trailer (past the cache), so an
/// admin hears when IMDb stops answering Lumen before the trailers quietly stop.
/// </summary>
public sealed class ImdbTrailersCheck : IHealthCheck
{
    /// <summary>Avengers: Endgame, whose first trailer IMDb has in 720p.</summary>
    internal const string ProbeTitle = "tt4154796";

    internal static readonly HealthFix OpenBanner = new("Open Hero banner settings", "setting", "hero");
    internal static readonly HealthFix OpenUpdates = new("Check for updates", "setting", "updates");

    private readonly ILumenConfigReader _config;
    private readonly IImdbTrailers _imdb;

    public ImdbTrailersCheck(ILumenConfigReader config, IImdbTrailers imdb)
    {
        _config = config;
        _imdb = imdb;
    }

    public string Id => "trailers.imdb";

    public string Group => HealthGroup.Trailers;

    public string Title => "IMDb trailers";

    public async Task<HealthCheckResult> RunAsync(bool fresh, CancellationToken cancellationToken)
    {
        var config = _config.Current;
        if (!config.TrailerPreview || !config.YouTubeTrailers)
        {
            return this.Result(
                HealthStatus.NotApplicable,
                "Online trailers are off: titles without a local trailer show their backdrop. Turn on \"Use online trailers\" under Hero banner to play IMDb's.",
                OpenBanner);
        }

        var check = await _imdb.CheckAsync(ProbeTitle, cancellationToken).ConfigureAwait(false);
        if (check.Url is not null)
        {
            return this.Result(HealthStatus.Ok, "IMDb answers Lumen's trailer lookups. Titles without a local trailer play IMDb's, else YouTube's.");
        }

        if (check.Problem is null)
        {
            return this.Result(
                HealthStatus.Warning,
                "IMDb answered, but without the trailer of a title that has one. IMDb may have changed its answers: update Lumen when a new version is out. Titles play YouTube's trailers meanwhile.",
                OpenUpdates);
        }

        if (check.Status is HttpStatusCode.Forbidden or HttpStatusCode.Unauthorized or HttpStatusCode.TooManyRequests)
        {
            return this.Result(
                HealthStatus.Problem,
                string.Create(CultureInfo.InvariantCulture, $"IMDb refused Lumen's trailer lookups (HTTP {(int)check.Status}). ") + "IMDb may have changed how its site asks for them: update Lumen when a new version is out. Titles play YouTube's trailers meanwhile.",
                OpenUpdates);
        }

        return this.Result(
            HealthStatus.Problem,
            "Lumen couldn't look up trailers on IMDb: " + HealthText.Scrub(check.Problem) + " Check that this server can reach the internet (a firewall or DNS filter may block IMDb). Titles play YouTube's trailers meanwhile.");
    }
}
