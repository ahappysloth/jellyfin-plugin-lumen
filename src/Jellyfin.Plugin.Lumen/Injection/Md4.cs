using System.Buffers.Binary;
using System.Numerics;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// MD4 (RFC 1320), which .NET doesn't ship: webpack 5's default hash function, so the one its content hashes are made with.
/// Used only to check that a jellyfin-web file name's hash belongs to the file's bytes, never for security.
/// </summary>
internal static class Md4
{
    public static byte[] Hash(ReadOnlySpan<byte> data)
    {
        uint a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
        var full = data.Length / 64 * 64;
        for (var offset = 0; offset < full; offset += 64)
        {
            Block(data.Slice(offset, 64), ref a, ref b, ref c, ref d);
        }

        // Padding: 0x80, zeros to 56 mod 64, then the length in bits, little-endian.
        Span<byte> tail = stackalloc byte[128];
        tail.Clear();
        var rest = data[full..];
        rest.CopyTo(tail);
        tail[rest.Length] = 0x80;
        var tailLength = rest.Length < 56 ? 64 : 128;
        BinaryPrimitives.WriteUInt64LittleEndian(tail[(tailLength - 8)..], (ulong)data.Length * 8);
        for (var offset = 0; offset < tailLength; offset += 64)
        {
            Block(tail.Slice(offset, 64), ref a, ref b, ref c, ref d);
        }

        var digest = new byte[16];
        BinaryPrimitives.WriteUInt32LittleEndian(digest, a);
        BinaryPrimitives.WriteUInt32LittleEndian(digest.AsSpan(4), b);
        BinaryPrimitives.WriteUInt32LittleEndian(digest.AsSpan(8), c);
        BinaryPrimitives.WriteUInt32LittleEndian(digest.AsSpan(12), d);
        return digest;
    }

    private static void Block(ReadOnlySpan<byte> block, ref uint a, ref uint b, ref uint c, ref uint d)
    {
        Span<uint> x = stackalloc uint[16];
        for (var i = 0; i < 16; i++)
        {
            x[i] = BinaryPrimitives.ReadUInt32LittleEndian(block[(i * 4)..]);
        }

        uint aa = a, bb = b, cc = c, dd = d;

        // Round 1: F(x, y, z) = (x & y) | (~x & z).
        for (var i = 0; i < 16; i += 4)
        {
            a = BitOperations.RotateLeft(a + ((b & c) | (~b & d)) + x[i], 3);
            d = BitOperations.RotateLeft(d + ((a & b) | (~a & c)) + x[i + 1], 7);
            c = BitOperations.RotateLeft(c + ((d & a) | (~d & b)) + x[i + 2], 11);
            b = BitOperations.RotateLeft(b + ((c & d) | (~c & a)) + x[i + 3], 19);
        }

        // Round 2: G(x, y, z) = (x & y) | (x & z) | (y & z), words in column order, plus 0x5a827999.
        for (var i = 0; i < 4; i++)
        {
            a = BitOperations.RotateLeft(a + ((b & c) | (b & d) | (c & d)) + x[i] + 0x5a827999, 3);
            d = BitOperations.RotateLeft(d + ((a & b) | (a & c) | (b & c)) + x[i + 4] + 0x5a827999, 5);
            c = BitOperations.RotateLeft(c + ((d & a) | (d & b) | (a & b)) + x[i + 8] + 0x5a827999, 9);
            b = BitOperations.RotateLeft(b + ((c & d) | (c & a) | (d & a)) + x[i + 12] + 0x5a827999, 13);
        }

        // Round 3: H(x, y, z) = x ^ y ^ z, words in bit-reversed order, plus 0x6ed9eba1.
        ReadOnlySpan<int> order = [0, 2, 1, 3];
        foreach (var i in order)
        {
            a = BitOperations.RotateLeft(a + (b ^ c ^ d) + x[i] + 0x6ed9eba1, 3);
            d = BitOperations.RotateLeft(d + (a ^ b ^ c) + x[i + 8] + 0x6ed9eba1, 9);
            c = BitOperations.RotateLeft(c + (d ^ a ^ b) + x[i + 4] + 0x6ed9eba1, 11);
            b = BitOperations.RotateLeft(b + (c ^ d ^ a) + x[i + 12] + 0x6ed9eba1, 15);
        }

        a += aa;
        b += bb;
        c += cc;
        d += dd;
    }
}
