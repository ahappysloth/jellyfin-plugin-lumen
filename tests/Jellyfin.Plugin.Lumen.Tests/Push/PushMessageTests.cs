using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Push;
using Jellyfin.Plugin.Lumen.Requests;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Push;

public class PushMessageTests
{
    [Fact]
    public void Ready_ForATitleInTheLibrary_OpensItsLibraryPage()
    {
        var message = Read(PushMessage.Ready(Item("Dune", jellyfinItemId: "abc123"), "token.sig"));

        Assert.Equal(1, message.GetProperty("v").GetInt32());
        Assert.Equal("ready", message.GetProperty("kind").GetString());
        Assert.Equal("Dune is ready to watch", message.GetProperty("title").GetString());
        Assert.Equal("abc123", message.GetProperty("item").GetString());
        Assert.False(message.TryGetProperty("key", out _));
        Assert.False(message.TryGetProperty("page", out _));
        Assert.Equal("lumen-ready-movie-438631", message.GetProperty("tag").GetString());
        Assert.Equal("Lumen/Assets/lumen-icon-192.png", message.GetProperty("icon").GetString());

        // The wide artwork, through Lumen's proxy, relative to the server (the worker adds its address).
        Assert.Equal("Lumen/Requests/Image/w780/backdrop.jpg?t=token.sig", message.GetProperty("image").GetString());
    }

    [Fact]
    public void Ready_ForATitleThisUserCantOpenInTheLibrary_OpensItsCatalogPage()
    {
        var message = Read(PushMessage.Ready(Item("Dune") with { Backdrop = null }, "token.sig"));

        Assert.Equal("movie-438631", message.GetProperty("key").GetString());
        Assert.False(message.TryGetProperty("item", out _));
        Assert.Equal("Lumen/Requests/Image/w780/poster.jpg?t=token.sig", message.GetProperty("image").GetString());
    }

    [Fact]
    public void Ready_WithoutArtwork_HasNoImage()
    {
        Assert.False(Read(PushMessage.Ready(Item("Dune") with { Backdrop = null, Poster = null }, "t")).TryGetProperty("image", out _));
        Assert.False(Read(PushMessage.Ready(Item("Dune"), null)).TryGetProperty("image", out _));
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("de-DE")]
    [InlineData("fr-CH")]
    public void ReadyMany_WritesTheNumberAsTheDevicesLanguageDoes_AndOpensMyRequests(string locale)
    {
        var items = Enumerable.Range(0, 1234).Select(i => Item("Title " + i)).ToList();

        var message = Read(PushMessage.ReadyMany(items, locale));

        // Whatever this machine's ICU says that language's thousands separator is.
        var count = 1234.ToString("N0", System.Globalization.CultureInfo.GetCultureInfo(locale));
        Assert.Equal(count + " of your requests are ready to watch", message.GetProperty("title").GetString());
        Assert.Equal("requests", message.GetProperty("page").GetString());
        Assert.StartsWith("Title 0, Title 1, ", message.GetProperty("body").GetString(), StringComparison.Ordinal);
        Assert.InRange(message.GetProperty("body").GetString()!.Length, 1, PushMessage.MaxTextLength);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not a language tag!")]
    public void ReadyMany_WithoutAKnownLanguage_StillWritesTheNumber(string? locale)
    {
        var message = Read(PushMessage.ReadyMany([Item("A"), Item("B"), Item("C"), Item("D")], locale));

        Assert.Equal("4 of your requests are ready to watch", message.GetProperty("title").GetString());
        Assert.Equal("A, B, C, D", message.GetProperty("body").GetString());
    }

    [Fact]
    public void AVeryLongTitle_IsClipped_SoTheMessageFitsOneRecord()
    {
        var message = PushMessage.Ready(Item(new string('x', 5000)) with { Poster = new string('p', 200) + ".jpg" }, new string('t', 60));

        Assert.Equal(PushMessage.MaxTextLength, message.Title.Length);
        Assert.EndsWith("…", message.Title, StringComparison.Ordinal);
        Assert.InRange(message.ToPayload().Length, 1, WebPushEncryption.MaxPlaintextLength);
    }

    [Fact]
    public void Test_SaysNotificationsWork()
    {
        var message = Read(PushMessage.Test());

        Assert.Equal("test", message.GetProperty("kind").GetString());
        Assert.Equal("Notifications are on", message.GetProperty("title").GetString());
        Assert.Equal("requests", message.GetProperty("page").GetString());
    }

    [Fact]
    public void TestLimiter_AllowsOneEveryTenSeconds_AndFiveInTenMinutes_PerUser()
    {
        var time = new FakeTimeProvider(TestData.Now);
        var limiter = new PushTestLimiter(time);
        var (alice, bob) = (Guid.NewGuid(), Guid.NewGuid());

        Assert.True(limiter.TryAcquire(alice, out _));
        Assert.False(limiter.TryAcquire(alice, out var wait));
        Assert.Equal(TimeSpan.FromSeconds(10), wait);
        Assert.True(limiter.TryAcquire(bob, out _)); // one user's tests don't hold another's back

        for (var i = 1; i < PushTestLimiter.MaxPerWindow; i++)
        {
            time.Advance(TimeSpan.FromSeconds(10));
            Assert.True(limiter.TryAcquire(alice, out _));
        }

        time.Advance(TimeSpan.FromSeconds(10));
        Assert.False(limiter.TryAcquire(alice, out wait));
        Assert.Equal(TimeSpan.FromMinutes(10) - TimeSpan.FromSeconds(50), wait);

        time.Advance(wait);
        Assert.True(limiter.TryAcquire(alice, out _));
    }

    private static CatalogItemDto Item(string title, string? jellyfinItemId = null) =>
        new("movie-438631", "movie", 438631, title, 2021, null, null, [], "poster.jpg", "backdrop.jpg", CatalogState.Available, jellyfinItemId);

    private static JsonElement Read(PushMessage message)
    {
        var json = Encoding.UTF8.GetString(message.ToPayload());
        Assert.DoesNotContain("null", json, StringComparison.Ordinal);
        return JsonDocument.Parse(json).RootElement.Clone();
    }
}
