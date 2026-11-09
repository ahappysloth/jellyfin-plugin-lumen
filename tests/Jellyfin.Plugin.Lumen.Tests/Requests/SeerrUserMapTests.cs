using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

public class SeerrUserMapTests
{
    private readonly ILumenConfigStore _store = Substitute.For<ILumenConfigStore>();
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly Guid _user = Guid.NewGuid();

    public SeerrUserMapTests()
    {
        _store.Current.Returns(Configured());
    }

    [Fact]
    public async Task NotConfigured_NoAccessAndNoSeerrCalls()
    {
        _store.Current.Returns(new PluginConfiguration { SeerrUrl = "http://seerr:5055", SeerrApiKey = "k" }); // RequestsEnabled is false

        Assert.Equal(RequestAccess.None, await Map().GetAccessAsync(_user, CancellationToken.None));
        await _seerr.DidNotReceiveWithAnyArgs().GetUserByJellyfinIdAsync(default!, default, default);
    }

    [Fact]
    public async Task MappedUser_GetsTheirSeerrPermissions_CachedForTenMinutes()
    {
        _seerr.GetUserByJellyfinIdAsync(Arg.Any<SeerrEndpoint>(), _user, Arg.Any<CancellationToken>()).Returns(new SeerrUser(4, 262144));
        var map = Map();

        var access = await map.GetAccessAsync(_user, CancellationToken.None);
        _time.Advance(TimeSpan.FromMinutes(9));
        await map.GetAccessAsync(_user, CancellationToken.None);

        Assert.Equal(new RequestAccess(true, true, false, 4), access);
        await _seerr.Received(1).GetUserByJellyfinIdAsync(Arg.Any<SeerrEndpoint>(), _user, Arg.Any<CancellationToken>());

        _time.Advance(TimeSpan.FromMinutes(2));
        await map.GetAccessAsync(_user, CancellationToken.None);
        await _seerr.Received(2).GetUserByJellyfinIdAsync(Arg.Any<SeerrEndpoint>(), _user, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task UnmappedUser_IsRecheckedAfterAMinute()
    {
        var map = Map();

        Assert.Equal(RequestAccess.None, await map.GetAccessAsync(_user, CancellationToken.None));
        _time.Advance(TimeSpan.FromSeconds(61));
        await map.GetAccessAsync(_user, CancellationToken.None);

        await _seerr.Received(2).GetUserByJellyfinIdAsync(Arg.Any<SeerrEndpoint>(), _user, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SeerrErrors_MeanNoAccess_AndAreNotCached()
    {
        _seerr.GetUserByJellyfinIdAsync(Arg.Any<SeerrEndpoint>(), _user, Arg.Any<CancellationToken>()).Throws(new SeerrException("down"));
        var map = Map();

        Assert.Equal(RequestAccess.None, await map.GetAccessAsync(_user, CancellationToken.None));
        await map.GetAccessAsync(_user, CancellationToken.None);

        await _seerr.Received(2).GetUserByJellyfinIdAsync(Arg.Any<SeerrEndpoint>(), _user, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task OpenBreaker_MeansNoAccess()
    {
        _seerr.GetUserByJellyfinIdAsync(Arg.Any<SeerrEndpoint>(), _user, Arg.Any<CancellationToken>())
            .Throws(new SeerrException("Seerr is temporarily unavailable.") { IsCircuitOpen = true });

        Assert.Equal(RequestAccess.None, await Map().GetAccessAsync(_user, CancellationToken.None));
    }

    [Fact]
    public async Task ChangingSeerrSettings_BypassesTheCache()
    {
        _seerr.GetUserByJellyfinIdAsync(Arg.Any<SeerrEndpoint>(), _user, Arg.Any<CancellationToken>()).Returns(new SeerrUser(4, 32));
        var map = Map();
        await map.GetAccessAsync(_user, CancellationToken.None);

        _store.Current.Returns(Configured(key: "new-key"));
        await map.GetAccessAsync(_user, CancellationToken.None);

        await _seerr.Received(1).GetUserByJellyfinIdAsync(Arg.Is<SeerrEndpoint>(e => e.ApiKey == "new-key"), _user, Arg.Any<CancellationToken>());
    }

    private static PluginConfiguration Configured(string key = "k") =>
        new() { RequestsEnabled = true, SeerrUrl = "http://seerr:5055", SeerrApiKey = key };

    private SeerrUserMap Map() => new(_store, _seerr, _time, NullLogger<SeerrUserMap>.Instance);
}
