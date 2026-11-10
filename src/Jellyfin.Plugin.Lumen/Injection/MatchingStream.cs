namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// A response body that compares what's written with the bytes expected, as it's written, without keeping a copy. At the
/// first byte that differs it starts keeping one (the matching part, from the expected bytes, then the rest), so whatever
/// was written can still be sent as it was.
/// </summary>
internal sealed class MatchingStream : Stream
{
    private readonly ReadOnlyMemory<byte> _expected;
    private int _position;
    private MemoryStream? _diverged;

    public MatchingStream(ReadOnlyMemory<byte> expected) => _expected = expected;

    /// <summary>Gets a value indicating whether exactly the expected bytes were written.</summary>
    public bool Matches => _diverged is null && _position == _expected.Length;

    /// <summary>Gets everything written.</summary>
    public ReadOnlyMemory<byte> Written => _diverged is null ? _expected[.._position] : _diverged.GetBuffer().AsMemory(0, (int)_diverged.Length);

    public override bool CanRead => false;

    public override bool CanSeek => false;

    public override bool CanWrite => true;

    public override long Length => _diverged?.Length ?? _position;

    public override long Position
    {
        get => Length;
        set => throw new NotSupportedException();
    }

    public override void Write(ReadOnlySpan<byte> buffer)
    {
        if (_diverged is null)
        {
            if (buffer.Length <= _expected.Length - _position && buffer.SequenceEqual(_expected.Span.Slice(_position, buffer.Length)))
            {
                _position += buffer.Length;
                return;
            }

            _diverged = new MemoryStream();
            _diverged.Write(_expected.Span[.._position]);
        }

        _diverged.Write(buffer);
    }

    public override void Write(byte[] buffer, int offset, int count) => Write(buffer.AsSpan(offset, count));

    public override void WriteByte(byte value) => Write([value]);

    public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
    {
        Write(buffer.AsSpan(offset, count));
        return Task.CompletedTask;
    }

    public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
    {
        Write(buffer.Span);
        return ValueTask.CompletedTask;
    }

    public override void Flush()
    {
    }

    public override Task FlushAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _diverged?.Dispose();
        }

        base.Dispose(disposing);
    }
}
