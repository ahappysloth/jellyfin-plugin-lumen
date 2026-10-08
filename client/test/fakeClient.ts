import type { AjaxRequest, JellyfinApiClient } from '../src/compat/jellyfin';

export interface FakeClient extends JellyfinApiClient {
  requests: AjaxRequest[];
  respond: (request: AjaxRequest) => unknown;
  userId: string | null;
}

/** A fake jellyfin-web ApiClient. URLs look like http://jf/<path>?<query>; responses come from `respond`. */
export function createFakeClient(
  respond: (request: AjaxRequest) => unknown = () => ({}),
  userId: string | null = 'user1',
): FakeClient {
  const client: FakeClient = {
    requests: [],
    respond,
    userId,
    getCurrentUserId: () => client.userId,
    accessToken: () => 'token1',
    deviceId: () => 'dev%2Bice',
    getUrl: (name, params) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params ?? {})) {
        if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
      }
      const qs = query.toString();
      return `http://jf/${name}${qs ? `?${qs}` : ''}`;
    },
    ajax: async (request) => {
      client.requests.push(request);
      return client.respond(request);
    },
    getPublicSystemInfo: async () => ({ Version: '12.1.0' }),
  };
  return client;
}

/** A responder from a path → value map; a value may be a function of the request. Unknown paths reject. */
export function routes(map: Record<string, unknown>): (request: AjaxRequest) => unknown {
  return (request) => {
    const path = new URL(request.url).pathname.slice(1);
    if (!(path in map)) return Promise.reject(new Error(`unexpected request: ${request.type} ${path}`));
    const value = map[path];
    return typeof value === 'function' ? (value as (r: AjaxRequest) => unknown)(request) : value;
  };
}
