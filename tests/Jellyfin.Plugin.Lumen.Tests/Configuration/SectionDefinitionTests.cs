using Jellyfin.Plugin.Lumen.Configuration;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Configuration;

public class SectionDefinitionTests
{
    [Fact]
    public void GetParam_IsCaseInsensitive_AndTreatsEmptyAsMissing()
    {
        var def = With(("LibraryId", "abc"), ("tag", string.Empty));

        Assert.Equal("abc", def.GetParam("libraryId"));
        Assert.Null(def.GetParam("tag"));
        Assert.Null(def.GetParam("missing"));
    }

    [Fact]
    public void TypedGetters_FallBackOnBadValues()
    {
        var id = Guid.NewGuid();
        var def = With(("count", "7"), ("bad", "x"), ("id", id.ToString()));

        Assert.Equal(7, def.GetIntParam("count", 3));
        Assert.Equal(3, def.GetIntParam("bad", 3));
        Assert.Equal(id, def.GetGuidParam("id"));
        Assert.Null(def.GetGuidParam("bad"));
    }

    private static SectionDefinition With(params (string Name, string Value)[] ps) =>
        new() { Params = ps.Select(p => new SectionParam { Name = p.Name, Value = p.Value }).ToList() };
}
