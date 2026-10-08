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

    private readonly Dictionary<string, LumenAsset> _assets;

    public AssetCatalog(IReadOnlyDictionary<string, byte[]> files)
    {
        _assets = files.ToDictionary(
            f => f.Key,
            f => new LumenAsset(f.Key, f.Value, ContentTypeFor(f.Key)),
            StringComparer.Ordinal);
        BuildHash = ComputeHash(files);
    }

    public string BuildHash { get; }

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
