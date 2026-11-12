using System.Diagnostics;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Storage;

/// <summary>Reads every video file in the libraries into a <see cref="StorageReportDto"/>.</summary>
public interface IStorageScanner
{
    StorageReportDto Scan(CancellationToken cancellationToken);
}

/// <summary>
/// Scans Jellyfin's database, never the files themselves: a file Jellyfin has no size for is "size unknown", since
/// reading it from an offline network share could hang the scan. It reads the ids of every movie, episode and video in
/// the libraries in one query, then loads them in batches without images or user data, so a library of tens of
/// thousands of episodes is read a page at a time. Each item's media sources (its versions, with their size and video
/// stream) come from Jellyfin's own <see cref="BaseItem.GetMediaSources"/>; a stacked movie's further parts (cd2…) are
/// items of their own that those leave out, so they're read alongside.
/// </summary>
public sealed class StorageScanner : IStorageScanner
{
    internal const int BatchSize = 500;

    private static readonly BaseItemKind[] VideoKinds = [BaseItemKind.Movie, BaseItemKind.Episode, BaseItemKind.Video, BaseItemKind.MusicVideo];

    private readonly ILibraryManager _libraryManager;
    private readonly TimeProvider _time;
    private readonly ILogger<StorageScanner> _logger;

    public StorageScanner(ILibraryManager libraryManager, TimeProvider time, ILogger<StorageScanner> logger)
    {
        _libraryManager = libraryManager;
        _time = time;
        _logger = logger;
    }

    public StorageReportDto Scan(CancellationToken cancellationToken)
    {
        var started = Stopwatch.GetTimestamp();
        var aggregator = new StorageAggregator();

        var libraries = new List<Folder>();
        foreach (var folder in _libraryManager.GetVirtualFolders())
        {
            if (Guid.TryParse(folder.ItemId, out var id) && _libraryManager.GetItemById(id) is Folder library)
            {
                libraries.Add(library);
                aggregator.AddLibrary(id, folder.Name, folder.CollectionType?.ToString());
            }
        }

        // No libraries, nothing to count (and an empty TopParentIds would mean "everywhere").
        IReadOnlyList<Guid> ids = libraries.Count == 0 ? [] : _libraryManager.GetItemIds(new InternalItemsQuery
        {
            IncludeItemTypes = VideoKinds,
            Recursive = true,
            IsVirtualItem = false,

            // Only the libraries: a channel plugin's videos and Live TV recordings kept outside them sit under other
            // top folders, and would make the total more than the libraries add up to. An item's top parent is the
            // folder of the library's path it's in, so a library is asked for by those, as Jellyfin's own views are.
            TopParentIds = libraries.SelectMany(TopParentIds).Distinct().ToArray(),

            // Nothing another item owns: extras, a stacked movie's further parts and local alternate versions. The
            // title they belong to adds its parts and versions; extras aren't counted.
            HasOwnerId = false,
        });

        HashSet<Guid>? scanned = null;
        for (var start = 0; start < ids.Count; start += BatchSize)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var batch = ids.Skip(start).Take(BatchSize).ToArray();
            var items = _libraryManager.GetItemList(new InternalItemsQuery { ItemIds = batch, DtoOptions = QueryOptions.IdsOnly() });
            foreach (var item in items)
            {
                cancellationToken.ThrowIfCancellationRequested();

                // A merged version is added with its title, as one of the title's media sources, unless the title is
                // outside the libraries: then the scan never reaches it, so the version counts on its own.
                var primaryOutside = item is Video { PrimaryVersionId: { } primary } && !(scanned ??= [.. ids]).Contains(primary);

                // Checked before reading its media sources: for a channel's video those cost the channel's own I/O.
                if (!StorageAggregator.Counts(item, primaryOutside))
                {
                    continue;
                }

                var inLibraries = _libraryManager.GetCollectionFolders(item, libraries).Select(f => f.Id).ToList();
                if (inLibraries.Count == 0)
                {
                    continue;
                }

                var sources = Sources(item);
                aggregator.Add(item, sources, inLibraries, Parts(item), SourceLibraries(item, sources, libraries), primaryOutside);
            }
        }

        var seconds = Stopwatch.GetElapsedTime(started).TotalSeconds;
        if (_logger.IsEnabled(LogLevel.Information))
        {
            _logger.LogInformation("Lumen storage report: {Count} videos read in {Seconds:0.0} s", ids.Count, seconds);
        }

        return aggregator.Build(_time.GetUtcNow(), Math.Round(seconds, 1));
    }

    /// <summary>The top parent ids a library's items carry: the folders of its paths (and its own, for anything
    /// that isn't a collection folder).</summary>
    private static IEnumerable<Guid> TopParentIds(Folder library) =>
        library is CollectionFolder collection ? collection.PhysicalFolderIds.Append(library.Id) : [library.Id];

    /// <summary>A stacked video's further parts (cd2, cd3…), found the way Jellyfin's own
    /// <see cref="Video.GetAdditionalParts"/> finds them, through the injected library manager.</summary>
    private List<(BaseItem Part, IReadOnlyList<MediaSourceInfo> Sources)>? Parts(BaseItem item)
    {
        if (item is not Video { AdditionalParts.Length: > 0 } video)
        {
            return null;
        }

        var parts = new List<(BaseItem, IReadOnlyList<MediaSourceInfo>)>(video.AdditionalParts.Length);
        foreach (var path in video.AdditionalParts)
        {
            if (_libraryManager.GetItemById(_libraryManager.GetNewItemId(path, typeof(Video))) is Video part)
            {
                parts.Add((part, Sources(part)));
            }
        }

        return parts;
    }

    /// <summary>
    /// The libraries of each media source's own item, where that isn't the title itself: a media source's id is its
    /// version's item id, and a version merged in from another library sits in that library's folder, not the title's.
    /// Null when every source is the title's own (the usual case: one file, one version), so it costs nothing more then.
    /// A source whose item can't be found goes with the title.
    /// </summary>
    private List<IEnumerable<Guid>?>? SourceLibraries(BaseItem item, IReadOnlyList<MediaSourceInfo> sources, List<Folder> libraries)
    {
        List<IEnumerable<Guid>?>? result = null;
        for (var i = 0; i < sources.Count; i++)
        {
            if (!Guid.TryParse(sources[i].Id, out var id) || id == item.Id || _libraryManager.GetItemById(id) is not { } version)
            {
                continue;
            }

            result ??= [.. Enumerable.Repeat<IEnumerable<Guid>?>(null, sources.Count)];
            result[i] = _libraryManager.GetCollectionFolders(version, libraries).Select(f => f.Id).ToList();
        }

        return result;
    }

    private IReadOnlyList<MediaSourceInfo> Sources(BaseItem item)
    {
        try
        {
            return item.GetMediaSources(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // One unreadable item is counted from what the item itself knows, rather than failing the whole report.
            if (_logger.IsEnabled(LogLevel.Debug))
            {
                _logger.LogDebug(ex, "Lumen storage report: no media sources for {Path}", item.Path);
            }

            return [];
        }
    }
}
