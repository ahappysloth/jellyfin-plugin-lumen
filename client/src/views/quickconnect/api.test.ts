import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { getUsers, signInApi } from './api';
import { statusOf } from './model';

/** jellyfin-web's ApiClient as far as these use it: getUrl builds the address, ajax would log it. */
function fakeClient() {
  return {
    getUrl: vi.fn(
      (name: string, params?: Record<string, unknown>) =>
        `http://jf/${name}${params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`,
    ),
    ajax: vi.fn(async () => []),
  } as unknown as JellyfinApiClient & { ajax: ReturnType<typeof vi.fn> };
}

afterEach(() => vi.unstubAllGlobals());

describe('signInApi', () => {
  it("asks whether the code was approved with a plain fetch, so the secret's address is never logged", async () => {
    const client = fakeClient();
    const fetch = vi.fn(async () => new Response('{"Authenticated":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(signInApi(client).connect('s3cret')).resolves.toEqual({ Authenticated: true });
    expect(fetch).toHaveBeenCalledWith('http://jf/QuickConnect/Connect?secret=s3cret');
    expect(client.ajax).not.toHaveBeenCalled();
  });

  it('rejects with the answer, as ajax does, so the flow reads its status; no answer is null', async () => {
    vi.stubGlobal('fetch', async () => new Response('Unknown secret', { status: 404 }));
    const error = await signInApi(fakeClient())
      .connect('s3cret')
      .catch((e: unknown) => e);
    expect(statusOf(error)).toBe(404);
    vi.stubGlobal('fetch', async () => Promise.reject(new TypeError('Failed to fetch')));
    expect(
      statusOf(
        await signInApi(fakeClient())
          .connect('s3cret')
          .catch((e: unknown) => e),
      ),
    ).toBeNull();
  });
});

describe('getUsers', () => {
  it('asks the server for the users who can sign in: never a disabled one', async () => {
    const client = fakeClient();
    await getUsers(client);
    expect(client.getUrl).toHaveBeenCalledWith('Users', { isDisabled: false });
  });
});
