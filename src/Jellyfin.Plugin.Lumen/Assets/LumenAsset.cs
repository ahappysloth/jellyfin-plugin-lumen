using System.IO.Compression;
using System.Security.Cryptography;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Lumen.Assets;

/// <summary>
/// An embedded client file. <see cref="Content"/> is always the raw bytes (the guard is inlined into index.html from
/// them). Scripts and stylesheets can also be served compressed: Brotli at its best quality and gzip at its smallest,
/// each made once (<see cref="AssetCatalog.PrecompressAsync"/>, or the first time a client asks). Jellyfin's own
/// response compression compresses them per response at its fastest level, and not at all over HTTPS.
/// </summary>
public sealed class LumenAsset
{
    public const string Brotli = "br";
    public const string Gzip = "gzip";

    private const int BrotliQuality = 11;
    private const int BrotliWindow = 24;

    private readonly Lazy<AssetRepresentation> _brotli;
    private readonly Lazy<AssetRepresentation> _gzip;

    public LumenAsset(string name, byte[] content, string contentType)
    {
        Name = name;
        Content = content;
        ContentType = contentType;
        Compressible = contentType.StartsWith("text/", StringComparison.Ordinal);
        var hash = Convert.ToHexStringLower(SHA256.HashData(content))[..16];
        Identity = new AssetRepresentation(content, null, new EntityTagHeaderValue($"\"{hash}\""));
        _brotli = new Lazy<AssetRepresentation>(() => new AssetRepresentation(CompressBrotli(content), Brotli, new EntityTagHeaderValue($"\"{hash}-br\"")));
        _gzip = new Lazy<AssetRepresentation>(() => new AssetRepresentation(CompressGzip(content), Gzip, new EntityTagHeaderValue($"\"{hash}-gz\"")));
    }

    public string Name { get; }

    /// <summary>The raw file.</summary>
    public byte[] Content { get; }

    public string ContentType { get; }

    /// <summary>Whether the file is text, and so is offered compressed (images are compressed already).</summary>
    public bool Compressible { get; }

    public AssetRepresentation Identity { get; }

    /// <summary>
    /// The representation to send for a request's Accept-Encoding: Brotli if the client takes it, else gzip, else the
    /// raw file. A coding is taken when it, or <c>*</c>, is listed without <c>q=0</c>. When the client takes one, the
    /// encoded file is sent even where it's bigger (a tiny file), so Jellyfin's compression never re-encodes a response.
    /// </summary>
    public AssetRepresentation Select(StringValues acceptEncoding)
    {
        if (!Compressible || !StringWithQualityHeaderValue.TryParseList(acceptEncoding, out var codings))
        {
            return Identity;
        }

        if (Accepts(codings, Brotli))
        {
            return _brotli.Value;
        }

        return Accepts(codings, Gzip) ? _gzip.Value : Identity;
    }

    private static bool Accepts(IList<StringWithQualityHeaderValue> codings, string coding)
    {
        var match = codings.FirstOrDefault(c => StringSegment.Equals(c.Value, coding, StringComparison.OrdinalIgnoreCase))
            ?? codings.FirstOrDefault(c => StringSegment.Equals(c.Value, "*", StringComparison.Ordinal));
        return match is not null && (match.Quality ?? 1) > 0;
    }

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
