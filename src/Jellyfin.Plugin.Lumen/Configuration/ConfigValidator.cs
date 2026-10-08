using System.Globalization;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.Lumen.Home;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Validates configuration before it is saved. Returns human-readable errors; empty means valid.</summary>
public sealed partial class ConfigValidator
{
    public const int MaxSections = 30;

    private readonly Dictionary<string, IHomeSectionProvider> _providers;

    public ConfigValidator(IEnumerable<IHomeSectionProvider> providers)
    {
        _providers = providers.ToDictionary(p => p.Type, StringComparer.OrdinalIgnoreCase);
    }

    public IReadOnlyList<string> Validate(PluginConfiguration config)
    {
        var errors = new List<string>();

        if (!HexColor().IsMatch(config.AccentColor ?? string.Empty))
        {
            errors.Add("Accent color must look like #RRGGBB.");
        }

        CheckRange(errors, "Hero item count", config.HeroCount, 1, 10);
        CheckRange(errors, "Hero rotation interval", config.HeroIntervalSeconds, 3, 60);
        CheckRange(errors, "Trailer delay", config.TrailerDelaySeconds, 0, 30);

        if (config.HeroSource == HeroSource.Collection && config.HeroCollectionId is null)
        {
            errors.Add("Hero source 'Collection' requires a collection.");
        }

        if (config.Sections.Count > MaxSections)
        {
            errors.Add($"There can be at most {MaxSections} sections.");
        }

        var seenIds = new HashSet<Guid>();
        for (var i = 0; i < config.Sections.Count; i++)
        {
            var section = config.Sections[i];
            var label = string.Create(CultureInfo.InvariantCulture, $"Section {i + 1} ({section.Type})");

            if (section.Id == Guid.Empty)
            {
                errors.Add($"{label}: is missing an id.");
            }
            else if (!seenIds.Add(section.Id))
            {
                errors.Add($"{label}: duplicate id.");
            }

            if (!_providers.TryGetValue(section.Type, out var provider))
            {
                errors.Add($"{label}: unknown section type '{section.Type}'.");
                continue;
            }

            ValidateParams(errors, label, section, provider);
            errors.AddRange(provider.Validate(section).Select(e => $"{label}: {e}"));
        }

        return errors;
    }

    private static void ValidateParams(List<string> errors, string label, SectionDefinition section, IHomeSectionProvider provider)
    {
        foreach (var parameter in provider.Parameters)
        {
            var value = section.GetParam(parameter.Name);
            if (value is null)
            {
                if (parameter.Required)
                {
                    errors.Add($"{label}: {parameter.Label} is required.");
                }

                continue;
            }

            switch (parameter.Kind)
            {
                case SectionParameterKind.Integer:
                    if (!int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number))
                    {
                        errors.Add($"{label}: {parameter.Label} must be a whole number.");
                    }
                    else if ((parameter.Min is { } min && number < min) || (parameter.Max is { } max && number > max))
                    {
                        errors.Add(string.Create(
                            CultureInfo.InvariantCulture,
                            $"{label}: {parameter.Label} must be between {parameter.Min} and {parameter.Max}."));
                    }

                    break;
                case SectionParameterKind.Library or SectionParameterKind.Collection or SectionParameterKind.Playlist:
                    if (!Guid.TryParse(value, out _))
                    {
                        errors.Add($"{label}: {parameter.Label} must be a valid id.");
                    }

                    break;
                case SectionParameterKind.Text:
                    if (value.Length > 200)
                    {
                        errors.Add($"{label}: {parameter.Label} must be at most 200 characters.");
                    }

                    break;
            }
        }

        var known = provider.Parameters.Select(p => p.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var unknown in section.Params.Where(p => !known.Contains(p.Name)))
        {
            errors.Add($"{label}: unknown parameter '{unknown.Name}'.");
        }
    }

    private static void CheckRange(List<string> errors, string name, int value, int min, int max)
    {
        if (value < min || value > max)
        {
            errors.Add(string.Create(CultureInfo.InvariantCulture, $"{name} must be between {min} and {max}."));
        }
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColor();
}
