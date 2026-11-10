namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>A file's size and modification time: when either changes, it's another file.</summary>
internal readonly record struct Stamp(long Length, DateTimeOffset LastModified);

/// <summary>A jellyfin-web file that may be cached for good: its path under /web, on disk, its content type, and its stamp.</summary>
internal sealed record WebFile(string SubPath, string PhysicalPath, string ContentType, Stamp Stamp);
