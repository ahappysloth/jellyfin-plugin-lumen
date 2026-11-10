using System.IO.Compression;
using System.Security.Cryptography;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Lumen.Assets;

/// <summary>
/// An embedded client file. <see cref="Content"/> is always the raw bytes (the guard is inlined into index.html from
/// them). Scripts and stylesheets can also be served compressed: Brotli at its best quality and gzip at its smallest,
/// each made once (<see cref="AssetCatalog.StartPrecompression"/>, or the first time a client asks). Jellyfin's own
/// response compression compresses them per response at its fastest level, and not at all over HTTPS.
/// </summary>
public sealed class LumenAsset
{
    public const string Brotli = "br";
    public const string Gzip = "gzip";

    private const int BrotliQuality = 11;
    private const int BrotliWindow = 24;

    private static readonly HashSet<string> CompressibleTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "application/javascript",
        "application/json",
        "application/manifest+json",
        "application/xml",
        "application/wasm",
        "image/svg+xml",
        "image/x-icon",
        "image/vnd.microsoft.icon",
        "font/ttf",
        "font/otf",
        "application/x-font-ttf",
        "application/vnd.ms-fontobject",
    };

    private readonly Encoded _brotli;
    private readonly Encoded _gzip;

    public LumenAsset(string name, byte[] content, string contentType)
        : this(name, content, contentType, Compress)
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="LumenAsset"/> class. For tests: <paramref name="compress"/> encodes
    /// the content in the coding it's given.
    /// </summary>
    internal LumenAsset(string name, byte[] content, string contentType, Func<byte[], string, byte[]> compress)
    {
        Name = name;
        Content = content;
        ContentType = contentType;
        Compressible = IsCompressible(contentType);
        var hash = Convert.ToHexStringLower(SHA256.HashData(content))[..16];
        Identity = new AssetRepresentation(content, null, new EntityTagHeaderValue($"\"{hash}\""));
        _brotli = new Encoded(() => new AssetRepresentation(compress(content, Brotli), Brotli, new EntityTagHeaderValue($"\"{hash}-br\"")));
        _gzip = new Encoded(() => new AssetRepresentation(compress(content, Gzip), Gzip, new EntityTagHeaderValue($"\"{hash}-gz\"")));
    }

    public string Name { get; }

    /// <summary>The raw file.</summary>
    public byte[] Content { get; }

    public string ContentType { get; }

    /// <summary>Whether the file is offered compressed (<see cref="IsCompressible"/>).</summary>
    public bool Compressible { get; }

    public AssetRepresentation Identity { get; }

    /// <summary>Whether both compressed copies have been made (by <see cref="Precompress"/> or by requests).</summary>
    internal bool IsPrecompressed => _brotli.IsCreated && _gzip.IsCreated;

    /// <summary>
    /// Whether a content type compresses: text, and the uncompressed binary and markup types jellyfin-web ships
    /// (WebAssembly, SVG, JSON, TrueType and Embedded OpenType fonts, icons). Already-compressed types (PNG, JPEG, GIF,
    /// WOFF and WOFF2, audio) aren't.
    /// </summary>
    public static bool IsCompressible(string contentType)
    {
        var mediaType = contentType.Split(';', 2)[0].Trim();
        return mediaType.StartsWith("text/", StringComparison.OrdinalIgnoreCase) || CompressibleTypes.Contains(mediaType);
    }

    /// <summary>
    /// The representation to send for a request's Accept-Encoding: of Brotli and gzip, the one with the higher q-value
    /// (Brotli on a tie), unless both are refused (q=0, or not listed and no <c>*</c>) or the client ranks
    /// <c>identity</c> above them. When the client takes a coding, the encoded file is sent even where it's bigger (a
    /// tiny file), so Jellyfin's compression never re-encodes a response. If compressing fails, the raw file is sent
    /// and the failure logged; the next request tries again.
    /// </summary>
    public AssetRepresentation Select(StringValues acceptEncoding, ILogger? logger = null)
    {
        if (!Compressible || !StringWithQualityHeaderValue.TryParseList(acceptEncoding, out var codings))
        {
            return Identity;
        }

        var brotli = Quality(codings, Brotli);
        var gzip = Quality(codings, Gzip);
        var best = Math.Max(brotli, gzip);
        if (best <= 0 || ExplicitQuality(codings, "identity") > best)
        {
            return Identity;
        }

        var encoded = brotli >= gzip ? _brotli : _gzip;
        try
        {
            return encoded.Value;
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "Lumen could not compress {Asset}; sending it uncompressed", Name);
            return Identity;
        }
    }

    /// <summary>Makes both compressed copies of a text file now. Throws if compressing fails (it's retried later).</summary>
    internal void Precompress()
    {
        if (Compressible)
        {
            _ = _brotli.Value;
            _ = _gzip.Value;
        }
    }

    /// <summary>The coding's q-value: its own entry, else <c>*</c>'s, else 0 (not acceptable).</summary>
    private static double Quality(IList<StringWithQualityHeaderValue> codings, string coding) =>
        ExplicitQuality(codings, coding)
        ?? codings.Where(c => StringSegment.Equals(c.Value, "*", StringComparison.Ordinal)).Select(c => c.Quality ?? 1).FirstOrDefault();

    private static double? ExplicitQuality(IList<StringWithQualityHeaderValue> codings, string coding) =>
        codings.Where(c => StringSegment.Equals(c.Value, coding, StringComparison.OrdinalIgnoreCase)).Select(c => (double?)(c.Quality ?? 1)).FirstOrDefault();

    private static byte[] Compress(byte[] content, string coding) => coding == Brotli ? CompressBrotli(content) : CompressGzip(content);

    private static byte[] CompressBrotli(byte[] content)
    {
        var buffer = new byte[BrotliEncoder.GetMaxCompressedLength(content.Length)];
        if (!BrotliEncoder.TryCompress(content, buffer, out var written, BrotliQuality, BrotliWindow))
        {
            throw new InvalidOperationException("Brotli compression failed.");
        }

        return buffer[..written];
    }

    private static byte[] CompressGzip(byte[] content)
    {
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.SmallestSize))
        {
            gzip.Write(content);
        }

        return output.ToArray();
    }
}

/// <summary>
/// A file's bytes in one content coding (null: the raw file). Each coding has its own entity tag, as HTTP requires: the
/// raw file's hash, with -br or -gz added, as for the rewritten index.html.
/// </summary>
public sealed class AssetRepresentation
{
    public AssetRepresentation(byte[] content, string? contentEncoding, EntityTagHeaderValue etag)
    {
        Content = content;
        ContentEncoding = contentEncoding;
        ETag = etag;
    }

    public byte[] Content { get; }

    public string? ContentEncoding { get; }

    public EntityTagHeaderValue ETag { get; }
}

/// <summary>
/// A compressed copy made once, on first use. Unlike <see cref="Lazy{T}"/> it doesn't keep an exception: a failed
/// attempt leaves nothing behind, and the next one tries again.
/// </summary>
internal sealed class Encoded
{
    private readonly Func<AssetRepresentation> _make;
    private readonly Lock _gate = new();
    private AssetRepresentation? _value;

    public Encoded(Func<AssetRepresentation> make) => _make = make;

    public bool IsCreated => Volatile.Read(ref _value) is not null;

    public AssetRepresentation Value
    {
        get
        {
            if (Volatile.Read(ref _value) is { } value)
            {
                return value;
            }

            lock (_gate)
            {
                _value ??= _make();
                return _value;
            }
        }
    }
}
