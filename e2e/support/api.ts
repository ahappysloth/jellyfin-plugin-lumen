import { readFileSync, writeFileSync } from 'node:fs';

export const BASE_URL = process.env.LUMEN_E2E_BASE_URL ?? 'http://localhost:8096';
export const MEDIA_PATH = process.env.LUMEN_E2E_MEDIA_PATH ?? '/media';
export const ADMIN = { name: 'admin', password: 'lumen-admin' };
export const KID = { name: 'kid', password: 'kid-pass' };

const STATE_FILE = new URL('../.state.json', import.meta.url);
const CLIENT_HEADER = 'MediaBrowser Client="Lumen E2E", Device="Playwright", DeviceId="lumen-e2e", Version="1.0.0"';

export interface Auth {
  token: string;
  userId: string;
}

export interface E2EState {
  admin: Auth;
  kid: Auth;
  /** Movie and series ids by name. */
  items: Record<string, string>;
  libraries: { movies: string; shows: string };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  token?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path.replace(/^\//, ''), BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: options.token ? `${CLIENT_HEADER}, Token="${options.token}"` : CLIENT_HEADER,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status} ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function authenticate(user: { name: string; password: string }): Promise<Auth> {
  const result = await api<{ AccessToken: string; User: { Id: string } }>('/Users/AuthenticateByName', {
    method: 'POST',
    body: { Username: user.name, Pw: user.password },
  });
  return { token: result.AccessToken, userId: result.User.Id };
}

export async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export function saveState(state: E2EState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function loadState(): E2EState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2EState;
}

export async function resetLumen(): Promise<void> {
  await api('/Lumen/Admin/Config/Reset', { method: 'POST', token: loadState().admin.token });
}
