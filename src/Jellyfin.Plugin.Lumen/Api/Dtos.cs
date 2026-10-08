using System.Diagnostics.CodeAnalysis;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Model.Dto;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Settings the client needs before rendering anything.</summary>
public sealed class ClientConfigDto
{
    public bool Enabled { get; init; }

    public bool HomeTakeover { get; init; }

    public bool DetailsTakeover { get; init; }

    public string AccentColor { get; init; } = string.Empty;

    public int HeroIntervalSeconds { get; init; }

    public bool TrailerPreview { get; init; }

    public int TrailerDelaySeconds { get; init; }

    public string BuildHash { get; init; } = string.Empty;

    public static ClientConfigDto From(PluginConfiguration config, string buildHash) => new()
    {
        Enabled = config.Enabled,
        HomeTakeover = config.HomeTakeover,
        DetailsTakeover = config.DetailsTakeover,
        AccentColor = config.AccentColor,
        HeroIntervalSeconds = config.HeroIntervalSeconds,
        TrailerPreview = config.TrailerPreview,
        TrailerDelaySeconds = config.TrailerDelaySeconds,
        BuildHash = buildHash,
    };
}

/// <summary>A client's compatibility self-test result.</summary>
public sealed class CompatReportDto
{
    public string Client { get; set; } = string.Empty;

    public string ServerVersion { get; set; } = string.Empty;

    [SuppressMessage("Usage", "CA2227:Collection properties should be read only", Justification = "JSON model binding.")]
    [SuppressMessage("Design", "CA1002:Do not expose generic lists", Justification = "JSON model binding.")]
    public List<string> FailedChecks { get; set; } = [];
}

/// <summary>One hero slide.</summary>
public sealed record HeroItemDto(BaseItemDto Item, Guid? TrailerItemId);

/// <summary>One home row.</summary>
public sealed record HomeRowDto(string Id, string Type, string Title, IReadOnlyList<BaseItemDto> Items);

/// <summary>Response of GET /Lumen/Home.</summary>
public sealed record HomeResponseDto(int ConfigVersion, IReadOnlyList<HeroItemDto> Hero, IReadOnlyList<HomeRowDto> Rows);

/// <summary>400 body for an invalid configuration.</summary>
public sealed record ValidationErrorsDto(IReadOnlyList<string> Errors);

/// <summary>A section parameter for the admin form.</summary>
public sealed record SectionParameterDto(string Name, string Label, string Kind, bool Required, string? DefaultValue, int? Min, int? Max)
{
    public static SectionParameterDto From(SectionParameter p) => new(p.Name, p.Label, p.Kind.ToString(), p.Required, p.DefaultValue, p.Min, p.Max);
}

/// <summary>A section type for the admin form.</summary>
public sealed record SectionTypeDto(string Type, string DisplayName, IReadOnlyList<SectionParameterDto> Parameters)
{
    public static SectionTypeDto From(IHomeSectionProvider provider) =>
        new(provider.Type, provider.DisplayName, provider.Parameters.Select(SectionParameterDto.From).ToList());
}
