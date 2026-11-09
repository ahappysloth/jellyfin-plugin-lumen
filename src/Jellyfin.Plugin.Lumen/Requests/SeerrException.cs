using System.Net;

namespace Jellyfin.Plugin.Lumen.Requests;

/// <summary>A Seerr call failed: unreachable, timed out, rejected the key, or returned something unexpected.</summary>
public sealed class SeerrException : Exception
{
    public SeerrException(string message, HttpStatusCode? status = null, Exception? inner = null, string? seerrMessage = null)
        : base(message, inner)
    {
        Status = status;
        SeerrMessage = seerrMessage;
    }

    public HttpStatusCode? Status { get; }

    /// <summary>The <c>message</c> from Seerr's error body (e.g. a quota or permission explanation), if it sent one.</summary>
    public string? SeerrMessage { get; }

    /// <summary>Gets a value indicating whether the call was refused by the circuit breaker without contacting Seerr.</summary>
    public bool IsCircuitOpen { get; init; }
}
