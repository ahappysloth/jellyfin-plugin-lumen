using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Home;
using Microsoft.AspNetCore.Mvc;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class AdminControllerTests
{
    private readonly ILumenConfigStore _store = Substitute.For<ILumenConfigStore>();

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
        new DiagnosticsStore());
}
