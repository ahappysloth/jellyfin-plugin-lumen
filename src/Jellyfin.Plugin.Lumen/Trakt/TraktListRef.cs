using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.Lumen.Trakt;

/// <summary>
/// A public Trakt list, from its web address: a user's list (<c>https://trakt.tv/users/{user}/lists/{list}</c>) or one
/// by id alone (<c>https://trakt.tv/lists/{id}</c>, as Trakt links official and shared lists). trakt.tv, www.trakt.tv
/// and app.trakt.tv are all Trakt; the scheme may be left out, and a query (<c>?sort=…</c>) or fragment is ignored.
/// </summary>
public sealed partial record TraktListRef
{
    private TraktListRef(string? user, string list)
    {
        User = user;
        List = list;
    }

    /// <summary>Gets the list's owner (their slug), or null for a list given by id alone.</summary>
    public string? User { get; }

    /// <summary>Gets the list's slug or id.</summary>
    public string List { get; }

    /// <summary>Gets the list's API path: <c>users/{user}/lists/{list}</c> or <c>lists/{list}</c>.</summary>
    public string ApiPath => User is null
        ? "lists/" + Uri.EscapeDataString(List)
        : "users/" + Uri.EscapeDataString(User) + "/lists/" + Uri.EscapeDataString(List);

    /// <summary>What the admin page says when the address isn't one.</summary>
    public static string Invalid => "Enter a public Trakt list's address, like https://trakt.tv/users/name/lists/list-name.";

    /// <summary>Reads a list's web address; false for anything that isn't one.</summary>
    public static bool TryParse(string? value, [NotNullWhen(true)] out TraktListRef? list)
    {
        list = null;
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return false;
        }

        if (!text.Contains("://", StringComparison.Ordinal))
        {
            text = "https://" + text;
        }

        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !uri.IsDefaultPort
            || !IsTraktHost(uri.Host))
        {
            return false;
        }

        var parts = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 4
            && parts[0].Equals("users", StringComparison.OrdinalIgnoreCase)
            && parts[2].Equals("lists", StringComparison.OrdinalIgnoreCase)
            && Slug().IsMatch(parts[1])
            && Slug().IsMatch(parts[3]))
        {
            list = new TraktListRef(parts[1], parts[3]);
            return true;
        }

        if (parts.Length == 2 && parts[0].Equals("lists", StringComparison.OrdinalIgnoreCase) && Slug().IsMatch(parts[1]))
        {
            list = new TraktListRef(null, parts[1]);
            return true;
        }

        return false;
    }

    public override string ToString() => User is null ? List : User + "/" + List;

    private static bool IsTraktHost(string host) =>
        host.Equals("trakt.tv", StringComparison.OrdinalIgnoreCase)
        || host.Equals("www.trakt.tv", StringComparison.OrdinalIgnoreCase)
        || host.Equals("app.trakt.tv", StringComparison.OrdinalIgnoreCase);

    /// <summary>A Trakt slug or id: letters, digits, dots, dashes and underscores, not starting with a dot (no "..").</summary>
    [GeneratedRegex("^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$")]
    private static partial Regex Slug();
}
