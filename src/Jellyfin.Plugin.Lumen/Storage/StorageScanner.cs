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

        for (var start = 0; start < ids.Count; start += BatchSize)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var batch = ids.Skip(start).Take(BatchSize).ToArray();
            var items = _libraryManager.GetItemList(new InternalItemsQuery { ItemIds = batch, DtoOptions = QueryOptions.IdsOnly() });
            foreach (var item in items)
            {
                cancellationToken.ThrowIfCancellationRequested();

                // Checked before reading its media sources: for a channel's video those cost the channel's own I/O.
                if (!StorageAggregator.Counts(item))
                {
                    continue;
                }

                var inLibraries = _libraryManager.GetCollectionFolders(item, libraries).Select(f => f.Id).ToList();
                if (inLibraries.Count == 0)
                {
                    continue;
                }

                aggregator.Add(item, Sources(item), inLibraries, Parts(item));
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
