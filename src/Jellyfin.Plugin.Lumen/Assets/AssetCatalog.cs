using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Assets;

/// <summary>The client files embedded in the plugin DLL, plus a content hash for cache busting.</summary>
public sealed partial class AssetCatalog
{
    public const string ResourcePrefix = "Lumen.Assets.";

    /// <summary>The client's content-named files (client/vite.config.ts): their names change with their content.</summary>
    public const string ChunkPrefix = "lumen-chunk-";

    private readonly Dictionary<string, LumenAsset> _assets;
    private readonly Lock _precompressionGate = new();

    public AssetCatalog(IReadOnlyDictionary<string, byte[]> files)
        : this(files, null)
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="AssetCatalog"/> class. For tests: <paramref name="compress"/>
    /// replaces the real compression (see <see cref="LumenAsset"/>).
    /// </summary>
    internal AssetCatalog(IReadOnlyDictionary<string, byte[]> files, Func<byte[], string, byte[]>? compress)
    {
        _assets = files.ToDictionary(
            f => f.Key,
            f => compress is null ? new LumenAsset(f.Key, f.Value, ContentTypeFor(f.Key)) : new LumenAsset(f.Key, f.Value, ContentTypeFor(f.Key), compress),
            StringComparer.Ordinal);
        BuildHash = ComputeHash(files);
        CoreChunk = FindCoreChunk(files);
    }

    public string BuildHash { get; }

    /// <summary>
    /// The content-named file with the client's code that lumen.js imports (client/src/entry.ts), read from lumen.js
    /// itself, or null if there isn't one. Content-named files start with <see cref="ChunkPrefix"/> and are cached for good.
    /// </summary>
    public string? CoreChunk { get; }

    public IReadOnlyCollection<string> Names => _assets.Keys;

    /// <summary>The background compression, once <see cref="StartPrecompression"/> has started it.</summary>
    internal Task? Precompression { get; private set; }

    public static AssetCatalog FromEmbeddedResources(Assembly assembly)
    {
        var files = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var resource in assembly.GetManifestResourceNames().Where(n => n.StartsWith(ResourcePrefix, StringComparison.Ordinal)))
        {
            using var stream = assembly.GetManifestResourceStream(resource)!;
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            files[resource[ResourcePrefix.Length..]] = buffer.ToArray();
        }

        return new AssetCatalog(files);
    }

    public bool TryGet(string name, out LumenAsset asset) => _assets.TryGetValue(name, out asset!);

    /// <summary>
    /// Starts making every compressed file on a background thread (once; later calls return the same task), so the
    /// first client after a restart doesn't wait for Brotli's best quality (about 0.25 s for the core chunk). A request
    /// that comes first waits for the same work. A file that fails is logged and left for requests to retry; the task
    /// itself never faults.
    /// </summary>
    public Task StartPrecompression(ILogger logger)
    {
        lock (_precompressionGate)
        {
            return Precompression ??= Task.Run(() =>
            {
                foreach (var asset in _assets.Values)
                {
                    try
                    {
                        asset.Precompress();
                    }
                    catch (Exception ex)
                    {
                        logger.LogError(ex, "Lumen could not compress {Asset}; it will be compressed when first requested", asset.Name);
                    }
                }
            });
        }
    }

    private static string ContentTypeFor(string name) => Path.GetExtension(name) switch
    {
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".png" => "image/png",
        _ => "application/octet-stream",
    };

    private static string? FindCoreChunk(IReadOnlyDictionary<string, byte[]> files)
    {
        if (!files.TryGetValue("lumen.js", out var entry))
        {
            return null;
        }

        var match = CoreImport().Match(Encoding.UTF8.GetString(entry));
        return match.Success && files.ContainsKey(match.Groups[1].Value) ? match.Groups[1].Value : null;
    }

    private static string ComputeHash(IReadOnlyDictionary<string, byte[]> files)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var file in files.OrderBy(f => f.Key, StringComparer.Ordinal))
        {
            hash.AppendData(Encoding.UTF8.GetBytes(file.Key));
            hash.AppendData(file.Value);
        }

        return Convert.ToHexStringLower(hash.GetHashAndReset())[..16];
    }

    [GeneratedRegex(@"\./(lumen-chunk-[A-Za-z0-9_-]+\.js)")]
    private static partial Regex CoreImport();
}
