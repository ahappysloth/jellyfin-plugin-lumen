using Jellyfin.Plugin.Lumen.Api;

namespace Jellyfin.Plugin.Lumen.Diagnostics;

/// <summary>A deduplicated compatibility report.</summary>
public sealed record DiagnosticEntry(string Client, string ServerVersion, IReadOnlyList<string> FailedChecks, DateTimeOffset LastSeen);

/// <summary>In-memory, bounded store of client compatibility reports for the admin page.</summary>
public sealed class DiagnosticsStore
{
    public const int Capacity = 50;
    private const int MaxText = 100;

    /// <summary>The client: its layout and whole user agent, which the Health tab reads the device and browser from.</summary>
    private const int MaxClient = 300;
    private const int MaxChecks = 20;

    private readonly Lock _gate = new();
    private readonly LinkedList<DiagnosticEntry> _entries = new();

    public void Record(CompatReportDto report, DateTimeOffset at)
    {
        var entry = new DiagnosticEntry(
            Truncate(report.Client, MaxClient),
            Truncate(report.ServerVersion),
            report.FailedChecks.Take(MaxChecks).Select(c => Truncate(c)).ToList(),
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

    private static string Truncate(string? value) => Truncate(value, MaxText);

    private static string Truncate(string? value, int max) => value is null ? string.Empty : value.Length <= max ? value : value[..max];
}
