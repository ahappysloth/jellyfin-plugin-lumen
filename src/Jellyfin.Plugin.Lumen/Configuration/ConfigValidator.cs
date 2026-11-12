using System.Globalization;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.Lumen.Home;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Validates configuration before it is saved. Returns human-readable errors; empty means valid.</summary>
public sealed partial class ConfigValidator
{
    public const int MaxSections = 30;

    /// <summary>
    /// The longest Quick Connect address, in UTF-8 bytes: the QR code holds 106 (client/src/views/quickconnect/qr.ts),
    /// and <c>/web/#/quickconnect?code=123456</c> takes 31 of them.
    /// </summary>
    public const int MaxQuickConnectAddressBytes = 75;

    private readonly Dictionary<string, IHomeSectionProvider> _providers;

    public ConfigValidator(IEnumerable<IHomeSectionProvider> providers)
    {
        _providers = providers.ToDictionary(p => p.Type, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>True when two Seerr addresses are the same (ignoring a trailing slash and the scheme/host's case).</summary>
    public static bool SameSeerr(string? a, string? b) =>
        string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)
            ? string.IsNullOrWhiteSpace(a) && string.IsNullOrWhiteSpace(b)
            : Uri.TryCreate(a.Trim().TrimEnd('/') + "/", UriKind.Absolute, out var ua)
              && Uri.TryCreate(b.Trim().TrimEnd('/') + "/", UriKind.Absolute, out var ub)
              && Uri.Compare(ua, ub, UriComponents.SchemeAndServer | UriComponents.PathAndQuery, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0;

    /// <summary>True for an absolute http(s) URL without credentials, query or fragment.</summary>
    public static bool IsHttpUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
        && string.IsNullOrEmpty(uri.UserInfo)
        && string.IsNullOrEmpty(uri.Query)
        && string.IsNullOrEmpty(uri.Fragment);

    /// <summary>
    /// Whether <paramref name="value"/> may be the public address for Quick Connect's QR codes: empty (not set), or an
    /// http(s) URL (<see cref="IsHttpUrl"/>, a base path allowed) short enough for the QR code. No <c>?</c> or <c>#</c>,
    /// even empty ones, which <see cref="Uri"/> drops: the client appends <c>/web/#/quickconnect…</c> to it as text.
    /// </summary>
    public static bool IsQuickConnectAddress(string? value) =>
        string.IsNullOrEmpty(value)
        || (IsHttpUrl(value)
            && value.IndexOfAny(['?', '#', '"', '<', '>', ' ']) < 0
            && System.Text.Encoding.UTF8.GetByteCount(value) <= MaxQuickConnectAddressBytes);

    public IReadOnlyList<string> Validate(PluginConfiguration config)
    {
        var errors = new List<string>();

        if (!HexColor().IsMatch(config.AccentColor ?? string.Empty))
        {
            errors.Add("Accent color must look like #RRGGBB.");
        }

        CheckRange(errors, "Hero item count", config.HeroCount, 1, 10);
        CheckRange(errors, "Hero rotation interval", config.HeroIntervalSeconds, 3, 60);
        CheckRange(errors, "Trailer delay", config.TrailerDelaySeconds, 0, 30);

        if (!Enum.IsDefined(config.HeroSource))
        {
            errors.Add("Hero source must be Recently added, Top rated unplayed or Collection.");
        }
        else if (config.HeroSource == HeroSource.Collection && config.HeroCollectionId is null)
        {
            errors.Add("Hero source 'Collection' requires a collection.");
        }

        CheckRange(errors, "Image cache size", config.ImageCacheMb, 50, 10_000);
        if (config.RequestsEnabled)
        {
            if (!IsHttpUrl(config.SeerrUrl))
            {
                errors.Add("Requests need Seerr's address, like http://seerr:5055.");
            }

            if (string.IsNullOrWhiteSpace(config.SeerrApiKey))
            {
                errors.Add("Requests need Seerr's API key (Seerr → Settings → General).");
            }
        }

        if (!IsQuickConnectAddress(config.QuickConnectAddress))
        {
            errors.Add(string.Create(
                CultureInfo.InvariantCulture,
                $"The public address for QR codes must be an http(s) address like https://jellyfin.example.com, at most {MaxQuickConnectAddressBytes} characters."));
        }

        // It goes in a request header: printable ASCII only, so it can't break the request. (Trakt's are 64 hex digits.)
        if (!string.IsNullOrEmpty(config.TraktClientId) && !IsTraktKey(config.TraktClientId))
        {
            errors.Add("The Trakt API key should be the Client ID of a Trakt app (trakt.tv/oauth/applications).");
        }

        // A POSTed config can carry JSON nulls that the non-nullable types do not rule out.
        List<SectionDefinition?>? sections = config.Sections!;
        if (sections is null)
        {
            errors.Add("Sections are required.");
            return errors;
        }

        if (sections.Count > MaxSections)
        {
            errors.Add($"There can be at most {MaxSections} sections.");
        }

        var seenIds = new HashSet<Guid>();
        for (var i = 0; i < sections.Count; i++)
        {
            var section = sections[i];
            if (section is null)
            {
                errors.Add(string.Create(CultureInfo.InvariantCulture, $"Section {i + 1}: is missing."));
                continue;
            }

            section.Params ??= [];
            var label = string.Create(CultureInfo.InvariantCulture, $"Section {i + 1} ({section.Type})");

            if (string.IsNullOrWhiteSpace(section.Type))
            {
                errors.Add($"{label}: section type is required.");
                continue;
            }

            if (section.Id == Guid.Empty)
            {
                errors.Add($"{label}: is missing an id.");
            }
            else if (!seenIds.Add(section.Id))
            {
                errors.Add($"{label}: duplicate id.");
            }

            if (!_providers.TryGetValue(section.Type, out var provider))
            {
                errors.Add($"{label}: unknown section type '{section.Type}'.");
                continue;
            }

            ValidateParams(errors, label, section, provider);
            errors.AddRange(provider.Validate(section).Select(e => $"{label}: {e}"));
        }

        return errors;
    }

    /// <summary>Whether <paramref name="key"/> could be a Trakt Client ID: printable ASCII that's safe in a header.</summary>
    internal static bool IsTraktKey(string key) => TraktKey().IsMatch(key);

    private static void ValidateParams(List<string> errors, string label, SectionDefinition section, IHomeSectionProvider provider)
    {
        foreach (var parameter in provider.Parameters)
        {
            var value = section.GetParam(parameter.Name);
            if (value is null)
            {
                if (parameter.Required)
                {
                    errors.Add($"{label}: {parameter.Label} is required.");
                }

                continue;
            }

            switch (parameter.Kind)
            {
                case SectionParameterKind.Integer:
                    if (!int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number))
                    {
                        errors.Add($"{label}: {parameter.Label} must be a whole number.");
                    }
                    else if ((parameter.Min is { } min && number < min) || (parameter.Max is { } max && number > max))
                    {
                        errors.Add(string.Create(
                            CultureInfo.InvariantCulture,
                            $"{label}: {parameter.Label} must be between {parameter.Min} and {parameter.Max}."));
                    }

                    break;
                case SectionParameterKind.Library or SectionParameterKind.Collection or SectionParameterKind.Playlist:
                    if (!Guid.TryParse(value, out _))
                    {
                        errors.Add($"{label}: {parameter.Label} must be a valid id.");
                    }

                    break;
                case SectionParameterKind.Text:
                    if (value.Length > 200)
                    {
                        errors.Add($"{label}: {parameter.Label} must be at most 200 characters.");
                    }

                    break;
            }
        }

        var known = provider.Parameters.Select(p => p.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var unknown in section.Params.Where(p => !known.Contains(p.Name)))
        {
            errors.Add($"{label}: unknown parameter '{unknown.Name}'.");
        }
    }

    private static void CheckRange(List<string> errors, string name, int value, int min, int max)
    {
        if (value < min || value > max)
        {
            errors.Add(string.Create(CultureInfo.InvariantCulture, $"{name} must be between {min} and {max}."));
        }
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColor();

    [GeneratedRegex("^[\\x21-\\x7E]{8,200}$")]
    private static partial Regex TraktKey();
}
