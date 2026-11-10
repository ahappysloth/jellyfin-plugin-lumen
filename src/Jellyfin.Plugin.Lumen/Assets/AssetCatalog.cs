using System.Reflection;
using System.Security.Cryptography;
using System.Text;

namespace Jellyfin.Plugin.Lumen.Assets;

/// <summary>An embedded client file.</summary>
public sealed record LumenAsset(string Name, byte[] Content, string ContentType);

/// <summary>The client files embedded in the plugin DLL, plus a content hash for cache busting.</summary>
public sealed class AssetCatalog
{
    public const string ResourcePrefix = "Lumen.Assets.";

    /// <summary>The client's content-named files (client/vite.config.ts): their names change with their content.</summary>
    public const string ChunkPrefix = "lumen-chunk-";

    private const string CoreChunkPrefix = ChunkPrefix + "main-";

    private readonly Dictionary<string, LumenAsset> _assets;

    public AssetCatalog(IReadOnlyDictionary<string, byte[]> files)
    {
        _assets = files.ToDictionary(
            f => f.Key,
            f => new LumenAsset(f.Key, f.Value, ContentTypeFor(f.Key)),
            StringComparer.Ordinal);
        BuildHash = ComputeHash(files);
        CoreChunk = files.Keys.Where(n => n.StartsWith(CoreChunkPrefix, StringComparison.Ordinal)).Order(StringComparer.Ordinal).FirstOrDefault();
    }

    public string BuildHash { get; }

    /// <summary>
    /// The content-named file with the client's code that lumen.js imports (client/src/entry.ts), or null if there isn't
    /// one. Content-named files start with <see cref="ChunkPrefix"/> and are cached for good.
    /// </summary>
    public string? CoreChunk { get; }

    public IReadOnlyCollection<string> Names => _assets.Keys;

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

    private static string ContentTypeFor(string name) => Path.GetExtension(name) switch
    {
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".png" => "image/png",
        _ => "application/octet-stream",
    };

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
}
