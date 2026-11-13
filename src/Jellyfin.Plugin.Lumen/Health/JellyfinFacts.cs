using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.MediaSegments;
using MediaBrowser.Model.Branding;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.Lumen.Health;

/// <summary><see cref="IJellyfinFacts"/> from the running server.</summary>
public sealed class JellyfinFacts : IJellyfinFacts
{
    private readonly IServerConfigurationManager _configuration;
    private readonly IPluginManager _plugins;
    private readonly ILibraryManager _library;
    private readonly IServiceProvider _services;

    public JellyfinFacts(IServerConfigurationManager configuration, IPluginManager plugins, ILibraryManager library, IServiceProvider services)
    {
        _configuration = configuration;
        _plugins = plugins;
        _library = library;
        _services = services;
    }

    public string BrandingCustomCss => _configuration.GetConfiguration<BrandingOptions>("branding").CustomCss ?? string.Empty;

    public bool QuickConnectEnabled => _configuration.Configuration.QuickConnectAvailable;

    public IReadOnlyList<InstalledPlugin> GetPlugins() =>
        _plugins.Plugins.Select(p => new InstalledPlugin(p.Name, p.Manifest.Status.ToString())).ToList();

    /// <summary>
    /// The providers Jellyfin's segment manager runs: every <see cref="IMediaSegmentProvider"/> plugins register. Read
    /// from the container (as the manager gets them), since the manager only lists them for a given video.
    /// </summary>
    public IReadOnlyList<string> GetSegmentProviders() =>
        _services.GetServices<IMediaSegmentProvider>().Select(p => p.Name).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    public IReadOnlyList<LibrarySegmentOptions> GetLibraries() =>
        _library.GetVirtualFolders()
            .Select(f => new LibrarySegmentOptions(
                f.Name,
                f.CollectionType?.ToString(),
                f.LibraryOptions?.DisabledMediaSegmentProviders ?? []))
            .ToList();

    /// <summary>
    /// One query for the items with an intro segment, against the episodes the library has. Jellyfin's segment manager
    /// only answers per item (thousands of queries for a big library); its database is the same one it reads.
    /// </summary>
    public async Task<IntroCoverage?> GetIntroCoverageAsync(CancellationToken cancellationToken)
    {
        if (_services.GetService<IDbContextFactory<JellyfinDbContext>>() is not { } factory)
        {
            return null;
        }

        var episodes = _library.GetItemIds(new InternalItemsQuery
        {
            IncludeItemTypes = [BaseItemKind.Episode],
            IsVirtualItem = false,
            Recursive = true,
        });
        if (episodes.Count == 0)
        {
            return new IntroCoverage(0, 0);
        }

        var db = await factory.CreateDbContextAsync(cancellationToken).ConfigureAwait(false);
        await using (db.ConfigureAwait(false))
        {
            var withIntro = await db.MediaSegments
                .Where(s => s.Type == MediaSegmentType.Intro)
                .Select(s => s.ItemId)
                .Distinct()
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
            var set = new HashSet<Guid>(episodes);
            return new IntroCoverage(withIntro.Count(set.Contains), episodes.Count);
        }
    }
}
