import { render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { setJellyfinLocale } from '../../test/locale';
import { DiagnosticsSettings } from '../admin/DiagnosticsSettings';
import { strings } from '../strings';
import { groupByAirDay } from '../views/browse/SuggestionsTabs';
import { Segmented } from '../views/browse/Toolbar';
import { airDate } from '../views/details/DetailsHeader';
import { endsAt } from '../views/player/PlayerExtras';
import {
  dateTimeLocale,
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  languageLocale,
  usableLocale,
} from './locale';

interface FakeWindowOptions {
  globalize?: Record<string, unknown>;
  storage?: Record<string, string>;
  userId?: string | null;
  culture?: string | null;
  language?: string;
  languages?: string[];
}

/** Just what util/locale.ts reads of a jellyfin-web page. */
function fakeWindow(o: FakeWindowOptions = {}): Window {
  const storage = o.storage ?? {};
  return {
    __lmnWebPlugin: o.globalize ? { deps: { globalize: o.globalize } } : undefined,
    ApiClient: { getCurrentUserId: () => (o.userId === undefined ? 'u1' : o.userId) },
    localStorage: { getItem: (key: string) => storage[key] ?? null },
    document: {
      documentElement: { getAttribute: (name: string) => (name === 'data-culture' ? o.culture : null) },
    },
    navigator: { language: o.language ?? 'en-US', languages: o.languages ?? [] },
  } as unknown as Window;
}

describe("the user's Jellyfin locale", () => {
  it("is jellyfin-web's globalize when its plugin hook handed it over", () => {
    const win = fakeWindow({
      globalize: { getCurrentLocale: () => 'fr-fr', getCurrentDateTimeLocale: () => 'de-de' },
      storage: { 'u1-language': 'it', 'u1-datetimelocale': 'es' },
    });
    expect(languageLocale(win)).toBe('fr-fr');
    expect(dateTimeLocale(win)).toBe('de-de');
  });

  it("is otherwise the signed-in user's stored settings, as userSettings keeps them", () => {
    const win = fakeWindow({
      storage: { 'u1-language': 'fr', 'u1-datetimelocale': 'de-DE', 'u2-language': 'it', language: 'es' },
      language: 'nl-NL',
    });
    expect(languageLocale(win)).toBe('fr');
    expect(dateTimeLocale(win)).toBe('de-DE');
  });

  it('reads the unprefixed keys with no one signed in, like appSettings', () => {
    expect(
      languageLocale(fakeWindow({ userId: null, storage: { language: 'es', 'u1-language': 'it' } })),
    ).toBe('es');
  });

  it('formats dates in the language when no date/time locale is set', () => {
    expect(dateTimeLocale(fakeWindow({ storage: { 'u1-language': 'fr' } }))).toBe('fr');
    expect(dateTimeLocale(fakeWindow({ globalize: { getCurrentLocale: () => 'fr' } }))).toBe('fr');
  });

  it("falls back to the page's culture, then the browser's language, like getDefaultLanguage", () => {
    expect(languageLocale(fakeWindow({ culture: 'sv-SE', language: 'nl-NL' }))).toBe('sv-SE');
    expect(languageLocale(fakeWindow({ language: 'nl-NL' }))).toBe('nl-NL');
    expect(languageLocale(fakeWindow({ language: '', languages: ['da'] }))).toBe('da');
    expect(dateTimeLocale(fakeWindow({ language: 'nl-NL' }))).toBe('nl-NL');
  });

  it('takes jellyfin-web underscore tags', () => {
    expect(usableLocale('pt_BR')).toBe('pt-BR');
    expect(formatNumber(1234, fakeWindow({ storage: { 'u1-language': 'pt_BR' } }))).toBe('1.234');
  });

  it('skips tags Intl rejects, and settings that fail to read, for the next source', () => {
    for (const bad of ['!!', 'de-DE-x', 'en_US_bogus', 42, null]) expect(usableLocale(bad)).toBeUndefined();
    const win = fakeWindow({
      globalize: { getCurrentLocale: () => '!!', getCurrentDateTimeLocale: () => 'de-DE-x' },
      storage: { 'u1-language': 'not a locale', 'u1-datetimelocale': 'en_US_bogus' },
      culture: '??',
      language: 'de-DE',
    });
    expect(languageLocale(win)).toBe('de-DE');
    expect(dateTimeLocale(win)).toBe('de-DE');
    const throwing = fakeWindow({
      globalize: {
        getCurrentLocale: () => {
          throw new Error('not ready');
        },
      },
      language: 'fr-FR',
    });
    (throwing as unknown as { localStorage: unknown }).localStorage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    };
    expect(languageLocale(throwing)).toBe('fr-FR');
  });

  it("leaves it to the browser when nothing is usable, so formatting doesn't throw", () => {
    const win = fakeWindow({ storage: { 'u1-language': '!!' }, language: '', languages: [] });
    expect(languageLocale(win)).toBeUndefined();
    expect(dateTimeLocale(win)).toBeUndefined();
    expect(formatNumber(1234, win)).toBe((1234).toLocaleString());
    expect(formatDate(new Date(0), { year: 'numeric' }, win)).toBe(
      new Date(0).toLocaleDateString(undefined, { year: 'numeric' }),
    );
  });

  it('formats numbers in the language and dates in the date/time locale', () => {
    const german = fakeWindow({ storage: { 'u1-language': 'de-DE' } });
    const englishTextGermanDates = fakeWindow({
      storage: { 'u1-language': 'en-us', 'u1-datetimelocale': 'de-de' },
      language: 'de-DE',
    });
    const date = new Date(Date.UTC(2010, 2, 4, 21, 42));
    const utc = { timeZone: 'UTC' } as const;
    expect(formatNumber(1234, german)).toBe('1.234');
    expect(formatDate(date, { ...utc, year: 'numeric', month: 'long', day: 'numeric' }, german)).toBe(
      '4. März 2010',
    );
    expect(formatTime(date, { ...utc, hour: 'numeric', minute: '2-digit' }, german)).toBe('21:42');
    expect(formatDateTime(new Date(2010, 2, 4, 21, 42), german)).toBe('4.3.2010, 21:42:00');
    // A German browser with Jellyfin in English: English numbers, the German dates the user asked for.
    expect(formatNumber(1234, englishTextGermanDates)).toBe('1,234');
    expect(formatDate(date, { ...utc, month: 'short', day: 'numeric' }, englishTextGermanDates)).toBe(
      '4. März',
    );
  });
});

describe("Lumen's dates and numbers", () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it("follow the user's Jellyfin settings, not the browser's", () => {
    restore = setJellyfinLocale('de-de');
    expect(strings.titleCount(1234)).toBe('1.234 titles');
    expect(strings.genreCount(1234)).toBe('1.234 genres');
    expect(strings.studioCount(1234)).toBe('1.234 studios');
    expect(strings.resultCount(1234)).toBe('1.234 results');
    expect(airDate('2010-03-04T00:00:00.0000000Z')).toBe('4. März 2010');
    const now = new Date(2026, 10, 10, 21, 0, 0).getTime();
    expect(endsAt({ positionMs: 10 * 60_000, durationMs: 52 * 60_000, rate: 1 }, now)).toBe('Ends at 21:42');
    const upcoming = groupByAirDay(
      [{ Id: 'e', Name: 'E', Type: 'Episode', PremiereDate: new Date(2026, 10, 13, 20).toISOString() }],
      new Date(2026, 10, 9, 12),
    );
    expect(upcoming.map((g) => g.label)).toEqual(['Fr., 13. Nov.']);
  });

  it('in the library chips and the diagnostics table', () => {
    restore = setJellyfinLocale('de-de');
    render(
      <Segmented
        label="Show"
        value="all"
        options={[{ value: 'all', label: 'All', count: 1234 }]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('1.234')).toBeInTheDocument();
    const lastSeen = new Date(2026, 10, 9, 14, 5);
    render(
      <DiagnosticsSettings
        diagnostics={[
          { Client: 'c', ServerVersion: '12.4', FailedChecks: ['x'], LastSeen: lastSeen.toISOString() },
        ]}
      />,
    );
    expect(screen.getByText('9.11.2026, 14:05:00')).toBeInTheDocument();
  });
});
