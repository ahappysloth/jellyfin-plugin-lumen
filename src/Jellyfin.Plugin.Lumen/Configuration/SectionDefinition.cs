using System.Diagnostics.CodeAnalysis;
using System.Globalization;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>One configured home section. Parameters are name/value strings because the config is XML-serialized.</summary>
public class SectionDefinition
{
    public Guid Id { get; set; }

    public string Type { get; set; } = string.Empty;

    public bool Enabled { get; set; } = true;

    public string? Title { get; set; }

    [SuppressMessage("Usage", "CA2227:Collection properties should be read only", Justification = "XML serialization requires a setter.")]
    [SuppressMessage("Design", "CA1002:Do not expose generic lists", Justification = "XML serialization requires a concrete List.")]
    public List<SectionParam> Params { get; set; } = [];

    /// <summary>Returns the parameter value, or null when absent or empty.</summary>
    public string? GetParam(string name)
    {
        var value = Params.FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))?.Value;
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    public int GetIntParam(string name, int fallback) =>
        int.TryParse(GetParam(name), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : fallback;

    public Guid? GetGuidParam(string name) => Guid.TryParse(GetParam(name), out var value) ? value : null;
}
