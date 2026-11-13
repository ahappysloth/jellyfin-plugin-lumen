using Jellyfin.Plugin.Lumen.Push;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Push;

public class ReadyPushTimingsTests
{
    [Fact]
    public void ARealServer_PassesEveryTwoMinutes_AndNeverRetriesSooner()
    {
        Assert.Equal(new ReadyPushTimings(TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(2)), ReadyPushTimings.Default);
        Assert.Equal(ReadyPushTimings.Default, ReadyPushTimings.From(null, null));
        Assert.Equal(ReadyPushTimings.Default, ReadyPushTimings.From(string.Empty, " "));
        Assert.True(ReadyPushTimings.Default.RetryDelay >= ReadyPushTimings.Default.Interval);

        // Neither variable is set where the unit tests run, as on a real server.
        Assert.Equal(ReadyPushTimings.Default, ReadyPushTimings.FromEnvironment());
    }

    [Fact]
    public void TheTestsServer_SetsItsOwn()
    {
        Assert.Equal(new ReadyPushTimings(TimeSpan.FromHours(1), TimeSpan.FromSeconds(2)), ReadyPushTimings.From("3600", "2"));
        Assert.Equal(new ReadyPushTimings(TimeSpan.FromMinutes(2), TimeSpan.FromSeconds(0.5)), ReadyPushTimings.From(null, "0.5"));
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-5")]
    [InlineData("0.01")]
    [InlineData("1e3")]
    [InlineData("100000")]
    [InlineData("soon")]
    [InlineData("NaN")]
    public void AValueThatMakesNoSense_IsIgnored(string value)
    {
        Assert.Equal(ReadyPushTimings.Default, ReadyPushTimings.From(value, value));
    }
}
