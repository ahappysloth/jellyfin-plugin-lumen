using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;

namespace Jellyfin.Plugin.Lumen.Tests;

/// <summary>Configurable provider for validator and home-service tests.</summary>
internal sealed class FakeSectionProvider : IHomeSectionProvider
{
    public FakeSectionProvider(string type, params SectionParameter[] parameters)
    {
        Type = type;
        Parameters = parameters;
    }

    public string Type { get; }

    public string DisplayName => Type + " (fake)";

    public IReadOnlyList<SectionParameter> Parameters { get; }

    public Func<SectionDefinition, IReadOnlyList<string>> ValidateRule { get; set; } = _ => [];

    public Func<HomeContext, SectionDefinition, CancellationToken, Task<IReadOnlyList<HomeRow>>> Rows { get; set; } =
        (_, _, _) => Task.FromResult<IReadOnlyList<HomeRow>>([]);

    public IReadOnlyList<string> Validate(SectionDefinition definition) => ValidateRule(definition);

    public Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken) =>
        Rows(context, definition, cancellationToken);
}
