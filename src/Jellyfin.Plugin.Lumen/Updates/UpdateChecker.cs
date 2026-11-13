using MediaBrowser.Common.Updates;
using MediaBrowser.Model.Updates;

namespace Jellyfin.Plugin.Lumen.Updates;

/// <summary>Where Lumen stands against its latest release, for the "Check for updates" button.</summary>
/// <param name="Installed">The running version (<c>0.3.2</c>).</param>
/// <param name="Latest">The newest version compatible with this server, from either source; null when none was found.</param>
/// <param name="Changelog">That version's changelog lines.</param>
/// <param name="UpdateAvailable">A newer compatible version can be installed now.</param>
/// <param name="ManifestReachable">Lumen's manifest on GitHub could be read.</param>
/// <param name="ListedByJellyfin">Jellyfin's own plugin repositories list Lumen (so its Plugins page and auto-update see it).</param>
/// <param name="RestartPending">A newer version is installed and waits for Jellyfin to restart.</param>
public sealed record UpdateStatusDto(
    string Installed,
    string? Latest,
    string? Changelog,
    bool UpdateAvailable,
    bool ManifestReachable,
    bool ListedByJellyfin,
    bool RestartPending);

/// <summary>
/// Checks for and installs Lumen updates through Jellyfin's own installer. Each check reads Lumen's manifest on GitHub
/// directly (past GitHub's few-minute CDN cache, so a release shows up as soon as it's published) and asks Jellyfin to
/// read its configured plugin repositories again; Jellyfin doesn't cache them, so that is a real recheck.
/// </summary>
public sealed class UpdateChecker
{
    /// <summary>Lumen's plugin repository manifest (the URL in the README's install steps).</summary>
    public const string ManifestUrl = "https://raw.githubusercontent.com/ahappysloth/jellyfin-plugin-lumen/main/manifest.json";

    private readonly IInstallationManager _installs;
    private readonly TimeProvider _time;
    private readonly Version _installed;
    private int _installCount;

    public UpdateChecker(IInstallationManager installs, TimeProvider time)
        : this(installs, time, typeof(LumenPlugin).Assembly.GetName().Version ?? new Version(0, 0, 0, 0))
    {
    }

    internal UpdateChecker(IInstallationManager installs, TimeProvider time, Version installed)
    {
        _installs = installs;
        _time = time;
        _installed = installed;
    }

    /// <summary>Gets how many updates have been installed since Jellyfin started: a kept check from before one is out of date.</summary>
    public int Installs => Volatile.Read(ref _installCount);

    public async Task<UpdateStatusDto> CheckAsync(CancellationToken cancellationToken)
    {
        var (manifest, reachable) = await FromManifestAsync(cancellationToken).ConfigureAwait(false);
        var repositories = await FromRepositoriesAsync(cancellationToken).ConfigureAwait(false);
        var newest = new[] { manifest, repositories }.Where(v => v is not null).MaxBy(v => v!.Version);
        var pending = _installs.CompletedInstallations.Any(i => i.Id == LumenPlugin.PluginId && i.Version > _installed);
        return new UpdateStatusDto(
            Format(_installed),
            newest is null ? null : Format(newest.Version),
            newest?.Changelog,
            newest is not null && newest.Version > _installed && !pending,
            reachable,
            repositories is not null,
            pending);
    }

    /// <summary>Installs <paramref name="version"/> (it must be a newer compatible version found by a fresh check).</summary>
    /// <returns>The status afterwards, or null when that version isn't available.</returns>
    public async Task<UpdateStatusDto?> InstallAsync(string version, CancellationToken cancellationToken)
    {
        if (!Version.TryParse(version, out var parsed))
        {
            return null;
        }

        // Checks report three parts (0.3.3) and manifests list four (0.3.3.0), which Version doesn't treat as equal.
        var wanted = new Version(parsed.Major, parsed.Minor, Math.Max(parsed.Build, 0), Math.Max(parsed.Revision, 0));

        var (manifest, _) = await FromManifestAsync(cancellationToken, wanted).ConfigureAwait(false);
        var package = manifest ?? await FromRepositoriesAsync(cancellationToken, wanted).ConfigureAwait(false);
        if (package is null || package.Version <= _installed)
        {
            return null;
        }

        // Jellyfin downloads the zip, checks it against the manifest's checksum and swaps it in on the next restart.
        await _installs.InstallPackage(package, cancellationToken).ConfigureAwait(false);
        Interlocked.Increment(ref _installCount);
        return await CheckAsync(cancellationToken).ConfigureAwait(false);
    }

    private static string Format(Version version) => version.ToString(3);

    private async Task<(InstallationInfo? Newest, bool Reachable)> FromManifestAsync(CancellationToken cancellationToken, Version? specific = null)
    {
        // A query string GitHub ignores, but its CDN caches by: a release is visible the moment it's published.
        var url = $"{ManifestUrl}?t={_time.GetUtcNow().ToUnixTimeMilliseconds()}";
        PackageInfo[] packages;
        try
        {
            // Jellyfin logs and swallows most failures (returning nothing); a timeout it lets through.
            packages = await _installs.GetPackages("Lumen", url, true, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            return (null, false);
        }

        return (Newest(packages, specific), packages.Length > 0);
    }

    private async Task<InstallationInfo?> FromRepositoriesAsync(CancellationToken cancellationToken, Version? specific = null)
    {
        try
        {
            var packages = await _installs.GetAvailablePackages(cancellationToken).ConfigureAwait(false);
            return Newest(packages, specific);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            return null;
        }
    }

    /// <summary>The newest version this server can run (Jellyfin drops ones built for a newer server).</summary>
    private InstallationInfo? Newest(IEnumerable<PackageInfo> packages, Version? specific) =>
        _installs.GetCompatibleVersions(packages, id: LumenPlugin.PluginId, specificVersion: specific).FirstOrDefault();
}
