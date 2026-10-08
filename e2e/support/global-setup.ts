import { ADMIN, BASE_URL, KID, MEDIA_PATH, api, authenticate, saveState, waitFor, type Auth } from './api';

const noRemoteMetadata = (types: string[]) => ({
  LibraryOptions: {
    EnableRealtimeMonitor: false,
    TypeOptions: types.map((Type) => ({ Type, MetadataFetchers: [], ImageFetchers: [] })),
  },
});

async function setPolicy(admin: Auth, userId: string, change: (policy: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const user = await api<{ Policy: Record<string, unknown> }>(`/Users/${userId}`, { token: admin.token });
  await api(`/Users/${userId}/Policy`, { method: 'POST', token: admin.token, body: change(user.Policy) });
}

/** Idempotent: completes the startup wizard, creates libraries and users, and resets Lumen's config. */
export default async function globalSetup(): Promise<void> {
  await waitFor(async () => ((await fetch(`${BASE_URL}/health`)).ok ? true : undefined), 120_000, 'server health');

  const info = await api<{ StartupWizardCompleted: boolean }>('/System/Info/Public');
  if (!info.StartupWizardCompleted) {
    await api('/Startup/Configuration', {
      method: 'POST',
      body: { UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' },
    });
    await api('/Startup/User');
    await api('/Startup/User', { method: 'POST', body: { Name: ADMIN.name, Password: ADMIN.password } });
    await api('/Startup/Complete', { method: 'POST' });
  }

  const admin = await authenticate(ADMIN);
  await api('/Lumen/ClientConfig', { token: admin.token }).catch(() => {
    throw new Error('Lumen is not loaded on the server (GET /Lumen/ClientConfig failed). Is the plugin installed?');
  });

  const existing = await api<{ Name: string }[]>('/Library/VirtualFolders', { token: admin.token });
  const ensureLibrary = async (name: string, collectionType: string, folder: string, types: string[]) => {
    if (existing.some((f) => f.Name === name)) return;
    // No per-library refresh: two back-to-back refreshes race and can leave a library empty.
    await api('/Library/VirtualFolders', {
      method: 'POST',
      token: admin.token,
      query: { name, collectionType, paths: `${MEDIA_PATH}/${folder}`, refreshLibrary: false },
      body: noRemoteMetadata(types),
    });
  };
  await ensureLibrary('Movies', 'movies', 'movies', ['Movie']);
  await ensureLibrary('Shows', 'tvshows', 'tv', ['Series', 'Season', 'Episode']);
  await api('/Library/Refresh', { method: 'POST', token: admin.token });

  const count = async (type: string) =>
    (await api<{ TotalRecordCount: number }>('/Items', {
      token: admin.token,
      query: { userId: admin.userId, recursive: true, includeItemTypes: type, limit: 0 },
    })).TotalRecordCount;
  const scanStarted = Date.now();
  let retriedRefresh = false;
  await waitFor(
    async () => {
      const episodes = await count('Episode');
      if (!retriedRefresh && episodes === 0 && Date.now() - scanStarted > 60_000) {
        retriedRefresh = true;
        await api('/Library/Refresh', { method: 'POST', token: admin.token });
      }
      return (await count('Movie')) >= 3 && episodes >= 6 ? true : undefined;
    },
    180_000,
    'library scan',
  );

  const libraries = await api<{ Name: string; ItemId: string }[]>('/Library/VirtualFolders', { token: admin.token });
  const libraryId = (name: string) => libraries.find((l) => l.Name === name)!.ItemId;

  const users = await api<{ Name: string; Id: string }[]>('/Users', { token: admin.token });
  const kidId =
    users.find((u) => u.Name === KID.name)?.Id ??
    (await api<{ Id: string }>('/Users/New', { method: 'POST', token: admin.token, body: { Name: KID.name, Password: KID.password } })).Id;
  // Hidden users make the login page show the manual username/password form.
  await setPolicy(admin, admin.userId, (p) => ({ ...p, IsHidden: true }));
  await setPolicy(admin, kidId, (p) => ({ ...p, IsHidden: true, EnableAllFolders: false, EnabledFolders: [libraryId('Shows')] }));
  const kid = await authenticate(KID);

  const all = await api<{ Items: { Id: string; Name: string }[] }>('/Items', {
    token: admin.token,
    query: { userId: admin.userId, recursive: true, includeItemTypes: 'Movie,Series' },
  });

  // Re-seed defaults now that libraries exist (per-library Recently Added rows).
  await api('/Lumen/Admin/Config/Reset', { method: 'POST', token: admin.token });

  saveState({
    admin,
    kid,
    items: Object.fromEntries(all.Items.map((i) => [i.Name, i.Id])),
    libraries: { movies: libraryId('Movies'), shows: libraryId('Shows') },
  });
}
