namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>How the admin UI renders a parameter, and how the validator checks it.</summary>
public enum SectionParameterKind
{
    Library,
    Collection,
    Playlist,
    Text,
    Integer,
}

/// <summary>A parameter a section type accepts.</summary>
public sealed record SectionParameter(
    string Name,
    string Label,
    SectionParameterKind Kind,
    bool Required = false,
    string? DefaultValue = null,
    int? Min = null,
    int? Max = null);
