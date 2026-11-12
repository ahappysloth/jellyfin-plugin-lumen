import type { UserInfo } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import type { SignInApi } from './model';

/**
 * Jellyfin's Quick Connect endpoints (QuickConnectController, 12.4). Initiate goes through jellyfin-web's ApiClient,
 * which adds the client header it needs (device, device id, app and version) whether or not anyone is signed in; its
 * ajax rejects with the fetch Response, so a caller reads the status from the error (model.ts statusOf).
 *
 * Connect is a plain fetch, rejecting the same way: ApiClient.ajax writes every URL it requests to the console, and
 * Connect's carries the secret, every few seconds. The server needs nothing else for it: no sign-in and no client
 * header (it looks the request up by its secret alone).
 */
export function signInApi(client: JellyfinApiClient): SignInApi {
  return {
    initiate: () =>
      client.ajax({
        type: 'POST',
        url: client.getUrl('QuickConnect/Initiate'),
        dataType: 'json',
      }) as Promise<{ Secret: string; Code: string }>,
    connect: (secret) =>
      fetch(client.getUrl('QuickConnect/Connect', { secret })).then((r) =>
        r.ok ? (r.json() as Promise<{ Authenticated?: boolean }>) : Promise.reject(r),
      ),
  };
}

/** Approves the request with `code`, signing its device in as `userId` (anyone else's needs an administrator). */
export async function authorize(client: JellyfinApiClient, code: string, userId: string): Promise<void> {
  await client.ajax({
    type: 'POST',
    url: client.getUrl('QuickConnect/Authorize', { code, userId }),
    dataType: 'json',
  });
}

/**
 * The users an administrator can sign a device in as ("sign in as"): every one but those disabled, whom the server
 * would still sign in (jellyfin-web's page leaves them out too).
 */
export function getUsers(client: JellyfinApiClient): Promise<UserInfo[]> {
  return client.ajax({
    type: 'GET',
    url: client.getUrl('Users', { isDisabled: false }),
    dataType: 'json',
  }) as Promise<UserInfo[]>;
}
