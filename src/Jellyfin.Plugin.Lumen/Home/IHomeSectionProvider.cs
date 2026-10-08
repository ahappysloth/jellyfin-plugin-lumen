using Jellyfin.Plugin.Lumen.Configuration;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Produces the rows for one section type. Add a row type by implementing this and registering it.</summary>
public interface IHomeSectionProvider
{
    string Type { get; }

    string DisplayName { get; }

    /// <summary>Gets the parameters; these drive the admin form and generic validation.</summary>
    IReadOnlyList<SectionParameter> Parameters { get; }

    /// <summary>Provider-specific rules beyond <see cref="Parameters"/>; returns human-readable errors.</summary>
    IReadOnlyList<string> Validate(SectionDefinition definition);

    /// <summary>Returns zero or more rows; an empty list means the section is omitted.</summary>
    Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken);
}
