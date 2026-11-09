using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Requests;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class AdminControllerTests
{
    private readonly ILumenConfigStore _store = Substitute.For<ILumenConfigStore>();
    private readonly ISeerrClient _seerr = Substitute.For<ISeerrClient>();
    private readonly IUserManager _users = Substitute.For<IUserManager>();
    private readonly IServerApplicationHost _host = Substitute.For<IServerApplicationHost>();

    public AdminControllerTests()
    {
        _host.SystemId.Returns("a1b2c3d4e5f60718293a4b5c6d7e8f90");
    }

    [Theory]
    [InlineData("a1b2c3d4e5f60718293a4b5c6d7e8f90", true)]
    [InlineData("A1B2C3D4-E5F6-0718-293A-4B5C6D7E8F90", true)]
    [InlineData("ffffffffffffffffffffffffffffffff", false)]
    public async Task TestSeerr_SaysWhetherSeerrIsLinkedToThisJellyfinServer(string seerrServerId, bool same)
    {
        _store.Current.Returns(new PluginConfiguration());
        _seerr.GetStatusAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<CancellationToken>()).Returns(new SeerrStatus("3.5.1"));
        _seerr.GetJellyfinServerAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<CancellationToken>()).Returns(new SeerrJellyfinServer("Home", seerrServerId));

        var result = (await Create().TestSeerr(new SeerrTestRequestDto("http://seerr:5055", "k"), CancellationToken.None)).Value!;

        Assert.True(result.Ok);
        Assert.Equal("Home", result.JellyfinServerName);
        Assert.Equal(same, result.SameJellyfinServer);
    }

    [Fact]
    public async Task TestSeerr_StillSucceedsWhenSeerrsJellyfinSettingsCantBeRead()
    {
        _store.Current.Returns(new PluginConfiguration());
        _seerr.GetStatusAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<CancellationToken>()).Returns(new SeerrStatus("3.5.1"));
        _seerr.GetJellyfinServerAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromException<SeerrJellyfinServer?>(new SeerrException("nope")));

        var result = (await Create().TestSeerr(new SeerrTestRequestDto("http://seerr:5055", "k"), CancellationToken.None)).Value!;

        Assert.True(result.Ok);
        Assert.Null(result.SameJellyfinServer);
    }

    [Fact]
    public void GetConfig_NeverReturnsTheSeerrKey()
    {
        _store.Current.Returns(new PluginConfiguration { SeerrApiKey = "secret" });

        var config = Create().GetConfig().Value!;

        Assert.Null(config.SeerrApiKey);
        Assert.True(config.SeerrApiKeySet);
        Assert.Equal("secret", _store.Current.SeerrApiKey);
    }

    [Fact]
    public async Task TestSeerr_UsesTheStoredKeyWhenNoneIsGiven_ForTheStoredAddress()
    {
        _store.Current.Returns(new PluginConfiguration { SeerrUrl = "http://seerr:5055", SeerrApiKey = "stored" });
        _seerr.GetStatusAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<CancellationToken>()).Returns(new SeerrStatus("3.5.1"));

        var result = (await Create().TestSeerr(new SeerrTestRequestDto("http://seerr:5055/", null), CancellationToken.None)).Value!;

        Assert.True(result.Ok);
        Assert.Equal("3.5.1", result.Version);
        await _seerr.Received().GetUserByJellyfinIdAsync(
            Arg.Is<SeerrEndpoint>(e => e.ApiKey == "stored" && e.BaseUrl == new Uri("http://seerr:5055/")), Guid.Empty, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task TestSeerr_NeverSendsTheStoredKeyToANewAddress()
    {
        _store.Current.Returns(new PluginConfiguration { SeerrUrl = "http://seerr:5055", SeerrApiKey = "stored" });

        var result = (await Create().TestSeerr(new SeerrTestRequestDto("http://typo-seerr:5055/", null), CancellationToken.None)).Value!;

        Assert.False(result.Ok);
        Assert.Contains("new address", result.Error, StringComparison.Ordinal);
        await _seerr.DidNotReceiveWithAnyArgs().GetStatusAsync(default!, default);
        await _seerr.DidNotReceiveWithAnyArgs().GetUserByJellyfinIdAsync(default!, default, default);
    }

    [Theory]
    [InlineData("not a url", "k", "address")]
    [InlineData("ftp://seerr", "k", "address")]
    [InlineData("http://seerr:5055", null, "API key")]
    public async Task TestSeerr_RejectsIncompleteSettings(string url, string? key, string message)
    {
        _store.Current.Returns(new PluginConfiguration());

        var result = (await Create().TestSeerr(new SeerrTestRequestDto(url, key), CancellationToken.None)).Value!;

        Assert.False(result.Ok);
        Assert.Contains(message, result.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TestSeerr_ReportsSeerrErrors()
    {
        _store.Current.Returns(new PluginConfiguration());
        _seerr.GetStatusAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<CancellationToken>()).Returns(new SeerrStatus("3.5.1"));
        _seerr.GetUserByJellyfinIdAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromException<SeerrUser?>(new SeerrException("Seerr rejected the API key.")));

        var result = (await Create().TestSeerr(new SeerrTestRequestDto("http://seerr:5055", "bad"), CancellationToken.None)).Value!;

        Assert.False(result.Ok);
        Assert.Equal("Seerr rejected the API key.", result.Error);
    }

    [Fact]
    public async Task SeerrUsers_ListsJellyfinUsersWithoutASeerrAccount_AndTheLinkedServer()
    {
        var mapped = TestData.User("mapped");
        var unmapped = TestData.User("unmapped");
        _store.Current.Returns(new PluginConfiguration { RequestsEnabled = true, SeerrUrl = "http://seerr:5055", SeerrApiKey = "k" });
        _users.GetUsers().Returns([mapped, unmapped]);
        _seerr.GetUserByJellyfinIdAsync(Arg.Any<SeerrEndpoint>(), mapped.Id, Arg.Any<CancellationToken>()).Returns(new SeerrUser(2, 32));
        _seerr.GetJellyfinServerAsync(Arg.Any<SeerrEndpoint>(), Arg.Any<CancellationToken>()).Returns(new SeerrJellyfinServer("Elsewhere", "ffff"));

        var result = (await Create().GetSeerrUsers(CancellationToken.None)).Value!;

        Assert.Equal("unmapped", Assert.Single(result.Unmapped).Name);
        Assert.Equal("Elsewhere", result.JellyfinServerName);
        Assert.False(result.SameJellyfinServer);
    }

    [Fact]
    public async Task SeerrUsers_IsEmptyWhenRequestsAreOff()
    {
        _store.Current.Returns(new PluginConfiguration { SeerrUrl = "http://seerr:5055", SeerrApiKey = "k" });

        var result = (await Create().GetSeerrUsers(CancellationToken.None)).Value!;

        Assert.Empty(result.Unmapped);
        Assert.Null(result.SameJellyfinServer);
        await _seerr.DidNotReceiveWithAnyArgs().GetUserByJellyfinIdAsync(default!, default, default);
    }

    [Fact]
    public void Save_Valid_Returns204()
    {
        _store.Save(Arg.Any<PluginConfiguration>()).Returns(new ConfigSaveResult(true, []));

        Assert.IsType<NoContentResult>(Create().SaveConfig(new PluginConfiguration()));
    }

    [Fact]
    public void Save_Invalid_Returns400WithErrors()
    {
        _store.Save(Arg.Any<PluginConfiguration>()).Returns(new ConfigSaveResult(false, ["bad"]));

        var result = Assert.IsType<BadRequestObjectResult>(Create().SaveConfig(new PluginConfiguration()));

        Assert.Equal(["bad"], Assert.IsType<ValidationErrorsDto>(result.Value).Errors);
    }

    [Fact]
    public void Reset_DelegatesToStore()
    {
        Assert.IsType<NoContentResult>(Create().Reset());
        _store.Received(1).ResetToDefaults();
    }

    [Fact]
    public void SectionTypes_AreSortedByName_WithStringKinds()
    {
        var types = Assert.IsAssignableFrom<IReadOnlyList<SectionTypeDto>>(Assert.IsType<OkObjectResult>(Create().GetSectionTypes().Result).Value);

        Assert.Equal(["Alpha (fake)", "Zeta (fake)"], types.Select(t => t.DisplayName));
        var parameter = Assert.Single(types[0].Parameters);
        Assert.Equal("Integer", parameter.Kind);
        Assert.Equal(3, parameter.Max);
    }

    private AdminController Create() => new(
        _store,
        [new FakeSectionProvider("Zeta"), new FakeSectionProvider("Alpha", new SectionParameter("n", "N", SectionParameterKind.Integer, Min: 1, Max: 3))],
        new DiagnosticsStore(),
        _seerr,
        _users,
        _host);
}
