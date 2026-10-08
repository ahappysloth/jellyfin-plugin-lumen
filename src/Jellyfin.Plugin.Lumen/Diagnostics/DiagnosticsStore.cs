using Jellyfin.Plugin.Lumen.Api;

namespace Jellyfin.Plugin.Lumen.Diagnostics;

/// <summary>A deduplicated compatibility report.</summary>
public sealed record DiagnosticEntry(string Client, string ServerVersion, IReadOnlyList<string> FailedChecks, DateTimeOffset LastSeen);

/// <summary>In-memory, bounded store of client compatibility reports for the admin page.</summary>
public sealed class DiagnosticsStore
{
    public const int Capacity = 50;
    private const int MaxText = 100;
    private const int MaxChecks = 20;

    private readonly Lock _gate = new();
    private readonly LinkedList<DiagnosticEntry> _entries = new();

    public void Record(CompatReportDto report, DateTimeOffset at)
    {
        var entry = new DiagnosticEntry(
            Truncate(report.Client),
            Truncate(report.ServerVersion),
            report.FailedChecks.Take(MaxChecks).Select(Truncate).ToList(),
            at);

        lock (_gate)
        {
            var existing = _entries.FirstOrDefault(e =>
                e.Client == entry.Client && e.ServerVersion == entry.ServerVersion && e.FailedChecks.SequenceEqual(entry.FailedChecks));
            if (existing is not null)
            {
                _entries.Remove(existing);
            }

            _entries.AddFirst(entry);
            while (_entries.Count > Capacity)
            {
                _entries.RemoveLast();
            }
        }
    }

    public IReadOnlyList<DiagnosticEntry> GetAll()
    {
        lock (_gate)
        {
            return _entries.ToList();
        }
    }

    private static string Truncate(string? value) => value is null ? string.Empty : value.Length <= MaxText ? value : value[..MaxText];
}
