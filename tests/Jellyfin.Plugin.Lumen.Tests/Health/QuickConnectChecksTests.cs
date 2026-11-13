using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Health;
using Jellyfin.Plugin.Lumen.Health.Checks;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Health;

public class QuickConnectChecksTests
{
    private readonly IJellyfinFacts _jellyfin = Substitute.For<IJellyfinFacts>();
    private readonly ILumenConfigReader _config = Substitute.For<ILumenConfigReader>();

    [Fact]
    public async Task Enabled_IsOk_Off_IsNotApplicable_WithALinkToGeneral()
    {
        _jellyfin.QuickConnectEnabled.Returns(true);
        Assert.Equal(HealthStatus.Ok, (await new QuickConnectCheck(_jellyfin).RunAsync(false, default)).Status);

        _jellyfin.QuickConnectEnabled.Returns(false);
        var off = await new QuickConnectCheck(_jellyfin).RunAsync(false, default);
        Assert.Equal(HealthStatus.NotApplicable, off.Status);
        Assert.Equal(new HealthFix("Open General", "dashboard", "general"), off.Fix);
    }

    [Fact]
    public async Task Address_ExplainsTheDefault_OrSaysItsSet_WithoutTheAddress()
    {
        _jellyfin.QuickConnectEnabled.Returns(true);
        _config.Current.Returns(new PluginConfiguration());
        var unset = await new QuickConnectAddressCheck(_config, _jellyfin).RunAsync(false, default);
        Assert.Equal(HealthStatus.Ok, unset.Status);
        Assert.StartsWith("Not set, so QR codes send phones to the address the TV or browser signing in uses.", unset.Message, StringComparison.Ordinal);

        _config.Current.Returns(new PluginConfiguration { QuickConnectAddress = "https://media.example.org" });
        var set = await new QuickConnectAddressCheck(_config, _jellyfin).RunAsync(false, default);
        Assert.Equal(HealthStatus.Ok, set.Status);
        Assert.DoesNotContain("example", set.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Address_QuickConnectOff_IsNotApplicable()
    {
        _jellyfin.QuickConnectEnabled.Returns(false);
        _config.Current.Returns(new PluginConfiguration());

        Assert.Equal(HealthStatus.NotApplicable, (await new QuickConnectAddressCheck(_config, _jellyfin).RunAsync(false, default)).Status);
    }
}
