using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public sealed class HomeCacheTests : IDisposable
{
    private static readonly HomeResponseDto Response = new(1, [], []);
    private readonly IUserDataManager _userData = Substitute.For<IUserDataManager>();
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly HomeCache _cache;
    private readonly Guid _alice = Guid.NewGuid();
    private readonly Guid _bob = Guid.NewGuid();

    public HomeCacheTests() => _cache = new HomeCache(_userData, _library, _time);

    public void Dispose() => _cache.Dispose();

    [Fact]
    public void Hit_UntilTtlExpires()
    {
        _cache.Set(_alice, 1, Response);

        Assert.True(_cache.TryGet(_alice, 1, out _));
        _time.Advance(HomeCache.Ttl + TimeSpan.FromSeconds(1));
        Assert.False(_cache.TryGet(_alice, 1, out _));
    }

    [Fact]
    public void Miss_WhenConfigVersionChanges()
    {
        _cache.Set(_alice, 1, Response);

        Assert.False(_cache.TryGet(_alice, 2, out _));
    }

    [Fact]
    public void UserDataSaved_EvictsOnlyThatUser()
    {
        _cache.Set(_alice, 1, Response);
        _cache.Set(_bob, 1, Response);

        _userData.UserDataSaved += Raise.EventWith(new UserDataSaveEventArgs { UserId = _alice });

        Assert.False(_cache.TryGet(_alice, 1, out _));
        Assert.True(_cache.TryGet(_bob, 1, out _));
    }

    [Fact]
    public void LibraryChange_InvalidatesEveryone()
    {
        _cache.Set(_alice, 1, Response);

        _library.ItemAdded += Raise.Event<EventHandler<ItemChangeEventArgs>>(_library, new ItemChangeEventArgs());

        Assert.False(_cache.TryGet(_alice, 1, out _));
    }

    [Fact]
    public void LibraryChanges_AreDebounced_LeadingAndTrailing()
    {
        var start = _cache.LibraryGeneration;

        for (var i = 0; i < 5; i++)
        {
            _library.ItemUpdated += Raise.Event<EventHandler<ItemChangeEventArgs>>(_library, new ItemChangeEventArgs());
            _time.Advance(TimeSpan.FromSeconds(1));
        }

        Assert.Equal(start + 1, _cache.LibraryGeneration);
        _time.Advance(HomeCache.LibraryDebounce);
        Assert.Equal(start + 2, _cache.LibraryGeneration);
        _time.Advance(HomeCache.LibraryDebounce * 3);
        Assert.Equal(start + 2, _cache.LibraryGeneration);
    }

    [Fact]
    public void Dispose_Unsubscribes()
    {
        _cache.Dispose();

        _userData.Received().UserDataSaved -= Arg.Any<EventHandler<UserDataSaveEventArgs>>();
        _library.Received().ItemRemoved -= Arg.Any<EventHandler<ItemChangeEventArgs>>();
    }
}
