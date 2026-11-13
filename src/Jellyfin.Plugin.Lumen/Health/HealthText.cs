using System.Globalization;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.Lumen.Health;

/// <summary>Wording helpers for the checks' messages, which also go into the copied report.</summary>
public static partial class HealthText
{
    /// <summary>
    /// Takes addresses out of an error message before it's shown (and copied into a bug report): .NET's connection errors
    /// name the host ("Connection refused (seerr.example.com:5055)"). Any URL goes, and so does the given address's host
    /// (with its port), each replaced by <paramref name="label"/> ("Seerr's address"). The host goes only where it stands
    /// as a host, not inside a word: a server named "seerr" leaves "Seerr's settings" alone.
    /// </summary>
    public static string Scrub(string message, Uri? address = null, string label = "its address")
    {
        ArgumentNullException.ThrowIfNull(message);
        var text = UrlPattern().Replace(message, label);
        if (address is not null && !string.IsNullOrEmpty(address.Host))
        {
            // Not after a letter, digit, dot or hyphen (a longer name), and not before one, except a dot that ends a
            // sentence. Case as given: hosts are written in lower case, and a capitalised word is prose.
            var host = new Regex(
                @"(?<![\w.-])" + Regex.Escape(address.Host) + @"(?::\d+)?(?![\w-]|\.\w)",
                RegexOptions.CultureInvariant,
                TimeSpan.FromSeconds(1));
            text = host.Replace(text, label.Replace("$", "$$", StringComparison.Ordinal));
        }

        return text;
    }

    /// <summary>"just now", "5 minutes ago", "3 hours ago", "2 days ago".</summary>
    public static string Ago(DateTimeOffset at, DateTimeOffset now)
    {
        var span = now - at;
        return span.TotalMinutes < 1 ? "just now"
            : span.TotalHours < 1 ? Plural((int)span.TotalMinutes, "minute") + " ago"
            : span.TotalDays < 1 ? Plural((int)span.TotalHours, "hour") + " ago"
            : Plural((int)span.TotalDays, "day") + " ago";
    }

    /// <summary>"1 episode", "1,204 episodes".</summary>
    public static string Plural(int count, string noun) =>
        count.ToString("N0", CultureInfo.InvariantCulture) + " " + (count == 1 ? noun : noun + "s");

    /// <summary>"A", "A and B", "A, B and C".</summary>
    public static string List(IReadOnlyList<string> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        return items.Count <= 1 ? string.Concat(items) : string.Join(", ", items.Take(items.Count - 1)) + " and " + items[^1];
    }

    [GeneratedRegex(@"\b[a-z][a-z0-9+.-]*://\S+", RegexOptions.IgnoreCase)]
    private static partial Regex UrlPattern();
}
