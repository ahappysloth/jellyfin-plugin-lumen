using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Jellyfin.Plugin.Lumen.Api;

namespace Jellyfin.Plugin.Lumen.Push;

/// <summary>
/// What a notification says and opens, as Lumen's service worker reads it (client/src/views/push/pushWorker.js). Addresses are
/// relative to the server's base (<c>Image</c>, <c>Icon</c>), and what to open is named, not linked: the worker knows
/// the web client's routes, the server doesn't. Nothing here is a secret: titles, and at most the user's artwork token
/// (<see cref="Requests.CatalogImageToken"/>), which only opens TMDB artwork.
/// </summary>
public sealed record PushMessage
{
    public const string ReadyKind = "ready";
    public const string TestKind = "test";

    /// <summary>The longest text sent: a notification shows a line or two, and the whole message must fit one record.</summary>
    public const int MaxTextLength = 180;

    /// <summary>More titles ready at once than this are announced together, not each on its own.</summary>
    public const int MaxSeparate = 3;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Gets the payload's version, for a worker older or newer than the server.</summary>
    public int V { get; init; } = 1;

    public required string Kind { get; init; }

    public required string Title { get; init; }

    public string? Body { get; init; }

    /// <summary>Gets the Jellyfin item to open (its details page), when the title is in the library for this user.</summary>
    public string? Item { get; init; }

    /// <summary>Gets the catalog title to open otherwise ("movie-603").</summary>
    public string? Key { get; init; }

    /// <summary>Gets the page to open when there's no single title: "requests".</summary>
    public string? Page { get; init; }

    /// <summary>Gets the picture, for platforms that show one (not iOS).</summary>
    public string? Image { get; init; }

    public string Icon { get; init; } = "Lumen/Assets/lumen-icon-192.png";

    /// <summary>Gets what replaces an earlier notification about the same thing instead of stacking under it.</summary>
    public string? Tag { get; init; }

    /// <summary>"Dune is ready to watch", opening the title in the library (or its catalog page).</summary>
    public static PushMessage Ready(CatalogItemDto item, string? imageToken) => new()
    {
        Kind = ReadyKind,
        Title = Clip(item.Title + " is ready to watch"),
        Body = "It’s in your library now.",
        Item = item.JellyfinItemId,
        Key = item.JellyfinItemId is null ? item.Key : null,
        Image = Artwork(item, imageToken),
        Tag = "lumen-ready-" + item.Key,
    };

    /// <summary>"5 of your requests are ready to watch", opening My requests. The number is written as <paramref name="locale"/> writes it.</summary>
    public static PushMessage ReadyMany(IReadOnlyList<CatalogItemDto> items, string? locale) => new()
    {
        Kind = ReadyKind,
        Title = items.Count.ToString("N0", Culture(locale)) + " of your requests are ready to watch",
        Body = Clip(string.Join(", ", items.Select(i => i.Title))),
        Page = "requests",
        Tag = "lumen-ready",
    };

    /// <summary>What "Send a test notification" sends.</summary>
    public static PushMessage Test() => new()
    {
        Kind = TestKind,
        Title = "Notifications are on",
        Body = "You’ll hear here when something you requested is ready to watch.",
        Page = "requests",
        Tag = "lumen-test",
    };

    public byte[] ToPayload() => JsonSerializer.SerializeToUtf8Bytes(this, Json);

    /// <summary>The culture a browser's language tag names ("de-CH"), or the invariant one.</summary>
    internal static CultureInfo Culture(string? locale)
    {
        if (!string.IsNullOrWhiteSpace(locale))
        {
            try
            {
                return CultureInfo.GetCultureInfo(locale);
            }
            catch (CultureNotFoundException)
            {
                // a tag .NET doesn't know
            }
        }

        return CultureInfo.InvariantCulture;
    }

    private static string? Artwork(CatalogItemDto item, string? imageToken)
    {
        // Wide where there is one: the platforms that show a picture show it wide.
        var file = item.Backdrop ?? item.Poster;
        return file is null || imageToken is null
            ? null
            : "Lumen/Requests/Image/w780/" + Uri.EscapeDataString(file) + "?t=" + Uri.EscapeDataString(imageToken);
    }

    private static string Clip(string text) => text.Length <= MaxTextLength ? text : string.Concat(text.AsSpan(0, MaxTextLength - 1), "…");
}
