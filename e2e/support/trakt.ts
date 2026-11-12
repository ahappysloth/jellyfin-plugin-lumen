import { api, loadState, SEERR_URL, STUB_SEERR } from './api';

// What the Top 10 and Trakt specs share: the stub's Trakt key (support/stub-seerr.mjs, reached through the server's
// LUMEN_TRAKT_API_BASE), the library items' ids, and a way to set Lumen up with Trakt and Seerr or without them.
export const TRAKT_KEY = 'stub-trakt-key';
// Seerr permission bits: REQUEST = 32. The admin is Seerr user 1 in every requests spec (Lumen caches the mapping).
const REQUEST_PERMISSION = 32;

// The fixture media has no TMDB or IMDb ids, so the library items Trakt's stub lists name get theirs here (Lumen Alpha
// only an IMDb id, so it matches the fallback way), and lose them again after each test. (Jellyfin also tries to write
// them to the items' .nfo files: read-only media in CI and the Docker loop, rewritten and then restored in the native one.)
export const PROVIDER_IDS: Record<string, Record<string, string>> = {
  'Lumen Beta': { Tmdb: '900002' },
  'Lumen Alpha': { Imdb: 'tt9000001' },
  'Lumen Show': { Tmdb: '900010' },
};

export async function setProviderIds(ids: (name: string) => Record<string, string>): Promise<void> {
  const { admin, items } = loadState();
  for (const name of Object.keys(PROVIDER_IDS)) {
    const id = items[name]!;
    // What GET gives, as jellyfin-web's metadata editor sends it back, less the trickplay info the server can't read.
    const { Trickplay: _, ...item } = await api<Record<string, unknown>>(`/Items/${id}`, {
      token: admin.token,
      query: { userId: admin.userId },
    });
    await api(`/Items/${id}`, { method: 'POST', token: admin.token, body: { ...item, ProviderIds: ids(name) } });
  }
}

/** The stub Seerr as the Trakt specs want it: no requests, the admin a Seerr user who may request, this server linked. */
export async function resetStub(): Promise<void> {
  const { admin } = loadState();
  await fetch(`${STUB_SEERR}/__stub/reset`, { method: 'POST' });
  await fetch(`${STUB_SEERR}/__stub/users`, {
    method: 'POST',
    body: JSON.stringify({ [admin.userId.replace(/-/g, '')]: { id: 1, permissions: REQUEST_PERMISSION } }),
  });
  await fetch(`${STUB_SEERR}/__stub/jellyfin`, {
    method: 'POST',
    body: JSON.stringify({ name: 'This server', serverId: (await api<{ Id: string }>('/System/Info/Public')).Id }),
  });
}

export interface Section {
  Type: string;
  Title?: string;
  Params?: { Name: string; Value: string }[];
}

/**
 * Puts `sections` first on home, with Trakt and Seerr as asked (saving also refreshes the home cache). With `only`, home
 * has just those sections.
 */
export async function configureTrakt(
  { trakt, seerr, only = false }: { trakt: boolean; seerr: boolean; only?: boolean },
  sections: Section[],
): Promise<void> {
  const { admin } = loadState();
  const config = await api<Record<string, unknown> & { Sections: unknown[] }>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', {
    method: 'POST',
    token: admin.token,
    body: {
      ...config,
      ...(seerr ? { RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'stub-key' } : {}),
      ...(trakt ? { TraktClientId: TRAKT_KEY } : { ClearTraktClientId: true }),
      Sections: [
        ...sections.map((s) => ({ Id: crypto.randomUUID(), Enabled: true, Params: [], ...s })),
        ...(only ? [] : config.Sections),
      ],
    },
  });
  if (seerr) {
    // Lumen keeps Seerr's titles 10 minutes, so a title an earlier test requested would still say Requested (the stub
    // has it so, as Seerr does), whatever the stub's reset. Filing a request through Lumen starts that cache over; the
    // stub then forgets the request.
    await api('/Lumen/Requests', { method: 'POST', token: admin.token, body: { MediaType: 'movie', TmdbId: 799 } });
    await fetch(`${STUB_SEERR}/__stub/reset`, { method: 'POST' });
  }
}
