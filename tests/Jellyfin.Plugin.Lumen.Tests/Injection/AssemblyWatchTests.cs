using System.Reflection;
using Jellyfin.Plugin.Lumen.Injection;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Injection;

public class AssemblyWatchTests
{
    [Fact]
    public void FindsAnAssemblyInAnyLoadContext()
    {
        Assert.True(new AssemblyWatch("xunit.core", TimeProvider.System).IsLoaded);
        Assert.False(new AssemblyWatch("Jellyfin.Plugin.FileTransformation", TimeProvider.System).IsLoaded);
    }

    [Fact]
    public void LooksAgainOnlyAfterTheInterval_AndNotOnceFound()
    {
        var time = new FakeTimeProvider();
        var lookups = 0;
        Assembly[] loaded = [];
        IEnumerable<Assembly> Lookup()
        {
            lookups++;
            return loaded;
        }

        var watch = new AssemblyWatch("xunit.core", time, Lookup, TimeSpan.FromSeconds(30));

        Assert.False(watch.IsLoaded);
        loaded = [typeof(FactAttribute).Assembly];
        time.Advance(TimeSpan.FromSeconds(29));
        Assert.False(watch.IsLoaded);
        Assert.Equal(1, lookups);

        time.Advance(TimeSpan.FromSeconds(1));
        Assert.True(watch.IsLoaded);
        Assert.True(watch.IsLoaded);
        Assert.Equal(2, lookups);
    }
}
