import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';

let collectionId: string | undefined;

test.afterEach(async () => {
  await resetLumen();
  if (collectionId) await api('/Items', { method: 'DELETE', token: loadState().admin.token, query: { ids: collectionId } });
});

test('a curated collection row shows the collection', async ({ page }) => {
  const { admin, items } = loadState();
  collectionId = (
    await api<{ Id: string }>('/Collections', {
      method: 'POST',
      token: admin.token,
      query: { name: 'Lumen Picks', ids: [items['Lumen Gamma'], items['Lumen Alpha']].join(',') },
    })
  ).Id;
  const config = await api<{ Sections: unknown[] } & Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', {
    method: 'POST',
    token: admin.token,
    body: {
      ...config,
      Sections: [
        { Id: crypto.randomUUID(), Type: 'Curated', Enabled: true, Title: null, Params: [{ Name: 'collectionId', Value: collectionId }] },
        ...config.Sections,
      ],
    },
  });

  await login(page, ADMIN);

  const row = page.getByRole('region', { name: 'Lumen Picks' });
  await expect(row.getByRole('button', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Lumen Gamma' })).toBeVisible();
});
