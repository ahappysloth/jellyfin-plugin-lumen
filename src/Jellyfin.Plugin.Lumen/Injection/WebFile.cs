using Jellyfin.Plugin.Lumen.Assets;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>Why <see cref="WebStaticFiles"/> takes a jellyfin-web file, which decides how long it may be cached.</summary>
internal enum WebFileKind
{
    /// <summary>Its name carries webpack's content hash.</summary>
    ContentHashed,

    /// <summary>index.html loads it with the build's hash in the query.</summary>
    IndexBundle,
}

/// <summary>A file's size and modification time: when either changes, it's another file.</summary>
internal readonly record struct Stamp(long Length, DateTimeOffset LastModified);

/// <summary>A jellyfin-web file Lumen serves: its path under /web, on disk, its content type, its stamp and kind.</summary>
internal sealed record WebFile(string SubPath, string PhysicalPath, string ContentType, Stamp Stamp, WebFileKind Kind);

/// <summary>A file's content and copies, and whether its name's content hash matched its bytes.</summary>
internal sealed record ReadyFile(LumenAsset Asset, bool HashMatches);
