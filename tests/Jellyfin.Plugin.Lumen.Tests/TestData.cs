using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.Lumen.Tests;

internal static class TestData
{
    public static readonly DateTimeOffset Now = new(2026, 10, 6, 12, 0, 0, TimeSpan.Zero);

    public static User User(string name = "alice") => new(name, "auth", "reset") { Id = Guid.NewGuid() };

    public static Movie Movie(string name, params string[] genres) =>
        new() { Id = Guid.NewGuid(), Name = name, Genres = genres, DateCreated = Now.UtcDateTime };

    public static Series Series(string name, params string[] genres) =>
        new() { Id = Guid.NewGuid(), Name = name, Genres = genres, DateCreated = Now.UtcDateTime };

    public static Episode Episode(Series series, int season, int number) => new()
    {
        Id = Guid.NewGuid(),
        Name = $"{series.Name} S{season}E{number}",
        SeriesId = series.Id,
        SeriesName = series.Name,
        ParentIndexNumber = season,
        IndexNumber = number,
        DateCreated = Now.UtcDateTime,
    };

    public static T WithImages<T>(this T item, params ImageType[] types)
        where T : BaseItem
    {
        item.ImageInfos = types.Select(t => new ItemImageInfo { Path = "/img/" + t, Type = t }).ToArray();
        return item;
    }

    public static UserItemData UserData(bool played = false, DateTime? lastPlayed = null) =>
        new() { Key = "k", Played = played, LastPlayedDate = lastPlayed };

    public static HomeContext Context(User user, WatchHistory? history = null) =>
        new(user, Now, () => Task.FromResult(history ?? WatchHistory.Empty));

    public static SectionDefinition Section(string type, params (string Name, string Value)[] parameters) => new()
    {
        Id = Guid.NewGuid(),
        Type = type,
        Params = parameters.Select(p => new SectionParam { Name = p.Name, Value = p.Value }).ToList(),
    };
}
