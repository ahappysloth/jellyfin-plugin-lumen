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
/// Scans Jellyfin's database, never the files themselves (except to size a local file Jellyfin has no size for). It
/// reads the ids of every movie, episode and video in one query, then loads them in batches without images or user
/// data, so a library of tens of thousands of episodes is read a page at a time. Each item's media sources (its
/// versions, with their size and video stream) come from Jellyfin's own <see cref="BaseItem.GetMediaSources"/>.
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
        var aggregator = new StorageAggregator(SizeOnDisk);

        var libraries = new List<Folder>();
        foreach (var folder in _libraryManager.GetVirtualFolders())
        {
            if (Guid.TryParse(folder.ItemId, out var id) && _libraryManager.GetItemById(id) is Folder library)
            {
                libraries.Add(library);
                aggregator.AddLibrary(id, folder.Name, folder.CollectionType?.ToString());
            }
        }

        var ids = _libraryManager.GetItemIds(new InternalItemsQuery
        {
            IncludeItemTypes = VideoKinds,
            Recursive = true,
            IsVirtualItem = false,
        });

        for (var start = 0; start < ids.Count; start += BatchSize)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var batch = ids.Skip(start).Take(BatchSize).ToArray();
            var items = _libraryManager.GetItemList(new InternalItemsQuery { ItemIds = batch, DtoOptions = QueryOptions.IdsOnly() });
            foreach (var item in items)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!StorageAggregator.Counts(item))
                {
                    continue;
                }

                var inLibraries = _libraryManager.GetCollectionFolders(item, libraries).Select(f => f.Id);
                aggregator.Add(item, Sources(item), inLibraries);
            }
        }

        var seconds = Stopwatch.GetElapsedTime(started).TotalSeconds;
        if (_logger.IsEnabled(LogLevel.Information))
        {
            _logger.LogInformation("Lumen storage report: {Count} videos read in {Seconds:0.0} s", ids.Count, seconds);
        }

        return aggregator.Build(_time.GetUtcNow(), Math.Round(seconds, 1));
    }

    private static long? SizeOnDisk(string path)
    {
        try
        {
            var file = new FileInfo(path);
            return file.Exists ? file.Length : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            return null;
        }
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
