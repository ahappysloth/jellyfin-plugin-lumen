using Jellyfin.Plugin.Lumen.Updates;
using MediaBrowser.Common.Updates;
using MediaBrowser.Model.Updates;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Updates;

public class UpdateCheckerTests
{
    private static readonly Version Installed = new(0, 3, 2, 0);

    private readonly IInstallationManager _installs = Substitute.For<IInstallationManager>();
    private readonly FakeTimeProvider _time = new(DateTimeOffset.FromUnixTimeMilliseconds(1_700_000_000_000));

    public UpdateCheckerTests()
    {
        // Jellyfin's own selection: Lumen's package, versions newest first (the real one also drops ones for a newer server).
        _installs.GetCompatibleVersions(Arg.Any<IEnumerable<PackageInfo>>(), Arg.Any<string?>(), Arg.Any<Guid>(), Arg.Any<Version?>(), Arg.Any<Version?>())
            .Returns(call =>
            {
                var specific = call.ArgAt<Version?>(4);
                return call.ArgAt<IEnumerable<PackageInfo>>(0)
                    .Where(p => p.Id == LumenPlugin.PluginId)
                    .SelectMany(p => p.Versions.Select(v => new InstallationInfo { Id = p.Id, Name = p.Name, Version = v.VersionNumber, Changelog = v.Changelog, SourceUrl = v.SourceUrl, Checksum = v.Checksum, PackageInfo = p }))
                    .Where(i => specific is null || i.Version == specific)
                    .OrderByDescending(i => i.Version)
                    .ToList();
            });
        _installs.CompletedInstallations.Returns([]);
        Repositories();
    }

    [Fact]
    public async Task Check_ReadsTheManifestPastGitHubsCache_AndOffersTheNewerVersion()
    {
        Manifest(Lumen("0.3.3.0", "0.3.2.0"));

        var status = await Checker().CheckAsync(CancellationToken.None);

        Assert.Equal(new UpdateStatusDto("0.3.2", "0.3.3", "Lumen 0.3.3.0 notes", true, true, false, false), status);
        await _installs.Received().GetPackages("Lumen", UpdateChecker.ManifestUrl + "?t=1700000000000", true, Arg.Any<CancellationToken>());

        // Jellyfin's repositories are read again too.
        await _installs.Received().GetAvailablePackages(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Check_UpToDate()
    {
        Manifest(Lumen("0.3.2.0", "0.3.1.0"));
        Repositories(Lumen("0.3.2.0"));

        var status = await Checker().CheckAsync(CancellationToken.None);

        Assert.False(status.UpdateAvailable);
        Assert.Equal("0.3.2", status.Latest);
        Assert.True(status.ListedByJellyfin);
    }

    [Fact]
    public async Task Check_UsesJellyfinsRepositories_WhenGitHubCantBeReached()
    {
        Manifest();
        Repositories(Lumen("0.3.3.0"));

        var status = await Checker().CheckAsync(CancellationToken.None);

        Assert.False(status.ManifestReachable);
        Assert.True(status.UpdateAvailable);
        Assert.Equal("0.3.3", status.Latest);
    }

    [Fact]
    public async Task Check_ReportsATimeoutAsUnreachable()
    {
        _installs.GetPackages("Lumen", Arg.Any<string>(), true, Arg.Any<CancellationToken>()).ThrowsAsync(new TaskCanceledException());

        var status = await Checker().CheckAsync(CancellationToken.None);

        Assert.False(status.ManifestReachable);
        Assert.Null(status.Latest);
        Assert.False(status.UpdateAvailable);
    }

    [Fact]
    public async Task Check_AnInstalledUpdateWaitsForARestart()
    {
        Manifest(Lumen("0.3.3.0"));
        _installs.CompletedInstallations.Returns([new InstallationInfo { Id = LumenPlugin.PluginId, Version = new Version(0, 3, 3, 0) }]);

        var status = await Checker().CheckAsync(CancellationToken.None);

        Assert.True(status.RestartPending);
        Assert.False(status.UpdateAvailable);
    }

    [Fact]
    public async Task Install_InstallsThatVersionThroughJellyfin()
    {
        Manifest(Lumen("0.3.4.0", "0.3.3.0"));

        var status = await Checker().InstallAsync("0.3.3", CancellationToken.None);

        Assert.NotNull(status);
        await _installs.Received(1).InstallPackage(
            Arg.Is<InstallationInfo>(i => i.Version == new Version(0, 3, 3, 0) && i.SourceUrl == "https://example/lumen_0.3.3.0.zip" && i.Checksum == "abc"),
            Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("0.3.2")]
    [InlineData("0.3.1")]
    [InlineData("9.9.9")]
    [InlineData("not a version")]
    public async Task Install_RefusesVersionsThatArentNewerAndAvailable(string version)
    {
        Manifest(Lumen("0.3.3.0", "0.3.2.0", "0.3.1.0"));

        Assert.Null(await Checker().InstallAsync(version, CancellationToken.None));
        await _installs.DidNotReceive().InstallPackage(Arg.Any<InstallationInfo>(), Arg.Any<CancellationToken>());
    }

    private static PackageInfo Lumen(params string[] versions) => new()
    {
        Id = LumenPlugin.PluginId,
        Name = "Lumen",
        Versions = versions.Select(v => new VersionInfo { Version = v, Changelog = $"Lumen {v} notes", SourceUrl = $"https://example/lumen_{v}.zip", Checksum = "abc" }).ToList(),
    };

    private UpdateChecker Checker() => new(_installs, _time, Installed);

    private void Manifest(params PackageInfo[] packages) =>
        _installs.GetPackages("Lumen", Arg.Any<string>(), true, Arg.Any<CancellationToken>()).Returns(packages);

    private void Repositories(params PackageInfo[] packages) =>
        _installs.GetAvailablePackages(Arg.Any<CancellationToken>()).Returns(packages);
}
