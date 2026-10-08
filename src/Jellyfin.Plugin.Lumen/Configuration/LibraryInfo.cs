namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>A library as seen by configuration code.</summary>
public sealed record LibraryInfo(Guid Id, string Name, string? CollectionType);
