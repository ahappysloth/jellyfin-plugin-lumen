using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>
/// YouTube video ids, read out of the trailer URLs metadata providers store and checked strictly: the client puts the id
/// in an embed address, so only the id ever leaves the server, never a URL someone could have written into an NFO.
/// </summary>
public static partial class YouTubeId
{
    private static readonly string[] Hosts = ["youtube.com", "youtube-nocookie.com", "youtu.be"];

    /// <summary>True for a bare video id: exactly 11 characters of YouTube's alphabet.</summary>
    public static bool IsValid([NotNullWhen(true)] string? id) => id is not null && Id().IsMatch(id);

    /// <summary>
    /// The video id of a YouTube address: <c>youtube.com/watch?v=</c> (TMDB's, which Jellyfin stores), <c>youtu.be/</c>,
    /// <c>/embed/</c>, <c>/v/</c>, <c>/shorts/</c> and <c>/live/</c>, with or without <c>www.</c>, <c>m.</c> or
    /// <c>music.</c>, over http or https, whatever else the query holds. Null for anything else: another site, a channel
    /// or playlist page, or an id that isn't 11 valid characters.
    /// </summary>
    public static string? FromUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)
            || !Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            return null;
        }

        var host = uri.IdnHost.ToLowerInvariant();
        foreach (var prefix in (string[])["www.", "m.", "music."])
        {
            if (host.StartsWith(prefix, StringComparison.Ordinal))
            {
                host = host[prefix.Length..];
                break;
            }
        }

        if (Array.IndexOf(Hosts, host) < 0)
        {
            return null;
        }

        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        string? id;
        if (host == "youtu.be")
        {
            id = segments.Length == 1 ? segments[0] : null;
        }
        else if (segments.Length == 1 && segments[0] == "watch")
        {
            id = QueryValue(uri.Query, "v");
        }
        else if (segments.Length == 2 && segments[0] is "embed" or "v" or "shorts" or "live")
        {
            id = segments[1];
        }
        else
        {
            id = null;
        }

        return IsValid(id) ? id : null;
    }

    /// <summary>The first value of <paramref name="name"/> in a query string, as written (an id needs no decoding).</summary>
    private static string? QueryValue(string query, string name)
    {
        foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var equals = pair.IndexOf('=', StringComparison.Ordinal);
            if (equals > 0 && pair.AsSpan(0, equals).SequenceEqual(name))
            {
                return pair[(equals + 1)..];
            }
        }

        return null;
    }

    [GeneratedRegex(@"^[A-Za-z0-9_-]{11}\z")]
    private static partial Regex Id();
}
