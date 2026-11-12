import type { UserInfo } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import type { SignInApi } from './model';

/**
 * Jellyfin's Quick Connect endpoints (QuickConnectController, 12.4), through jellyfin-web's ApiClient, which adds the
 * client header Initiate needs (device, device id, app and version) whether or not anyone is signed in. Its ajax
 * rejects with the fetch Response, so a caller reads the status from the error (model.ts statusOf).
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
      client.ajax({
        type: 'GET',
        url: client.getUrl('QuickConnect/Connect', { secret }),
        dataType: 'json',
      }) as Promise<{ Authenticated?: boolean }>,
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

/** Every user on the server (administrators only), for "sign in as". */
export function getUsers(
  client: JellyfinApiClient,
): Promise<(UserInfo & { Policy?: { IsDisabled?: boolean } })[]> {
  return client.ajax({ type: 'GET', url: client.getUrl('Users'), dataType: 'json' }) as Promise<UserInfo[]>;
}
