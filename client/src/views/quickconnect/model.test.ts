import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPROVE_HASH,
  approveOutcome,
  approveUrl,
  codeFromHash,
  createSignInFlow,
  groupCode,
  isCompleteCode,
  MAX_REFRESHES,
  normalizeCode,
  POLL_MS,
  publicAddressSetting,
  qrBase,
  statusOf,
  type SignInApi,
  type SignInState,
} from './model';

describe('the code', () => {
  it('keeps digits only, at most six: a pasted "123 456" arrives whole', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode(' 12-34a5x6 ')).toBe('123456');
    expect(normalizeCode('1234567')).toBe('123456');
    expect(normalizeCode('abc')).toBe('');
    expect(normalizeCode('12345')).toBe('12345');
  });

  it('is complete at six digits, and shown as three and three', () => {
    expect(isCompleteCode('123456')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
    expect(groupCode('123456')).toBe('123 456');
  });
});

describe('a code in the address', () => {
  it('is read only as six digits, and never the userId', () => {
    expect(codeFromHash('#/quickconnect?code=123456')).toBe('123456');
    expect(codeFromHash('#/quickconnect?userId=abc&code=654321')).toBe('654321');
    expect(codeFromHash('#/quickconnect?code=12345')).toBeNull();
    expect(codeFromHash('#/quickconnect?code=1234567')).toBeNull();
    expect(codeFromHash('#/quickconnect?code=12a456')).toBeNull();
    expect(codeFromHash('#/quickconnect?userId=123456')).toBeNull();
    expect(codeFromHash('#/quickconnect')).toBeNull();
  });

  it('leaves the address as the bare page', () => {
    expect(APPROVE_HASH).toBe('#/quickconnect');
  });
});

describe('approveOutcome', () => {
  it("maps the server's five answers, and no answer", () => {
    expect(approveOutcome(200)).toBe('approved');
    expect(approveOutcome(204)).toBe('approved');
    expect(approveOutcome(404)).toBe('invalid');
    expect(approveOutcome(500)).toBe('used');
    // 401 is two things: Quick Connect off (asked afterwards), or this page's own sign-in run out.
    expect(approveOutcome(401, false)).toBe('disabled');
    expect(approveOutcome(401, true)).toBe('signedOut');
    expect(approveOutcome(401, undefined)).toBe('signedOut');
    expect(approveOutcome(null)).toBe('offline');
    expect(approveOutcome(403)).toBe('failed');
  });

  it('reads the status from the Response jellyfin-web rejects with', () => {
    expect(statusOf({ status: 404 })).toBe(404);
    expect(statusOf(new TypeError('Failed to fetch'))).toBeNull();
    expect(statusOf(null)).toBeNull();
  });
});

describe('the QR code address', () => {
  const location = (href: string) => {
    const url = new URL(href);
    return { href, origin: url.origin, pathname: url.pathname };
  };
  afterEach(() => document.head.querySelectorAll('meta').forEach((m) => m.remove()));

  it("is the device's own address without the setting, never with a query or hash", () => {
    expect(qrBase(null, location('http://192.168.1.20:8096/web/#/login?serverid=x'))).toBe(
      'http://192.168.1.20:8096/web/',
    );
    expect(qrBase(null, location('https://box.tail1234.ts.net/jellyfin/web/index.html?x=1#/login'))).toBe(
      'https://box.tail1234.ts.net/jellyfin/web/index.html',
    );
  });

  it('is the public address when the admin set one, with its base path', () => {
    const here = location('http://192.168.1.20:8096/web/');
    expect(qrBase('https://jellyfin.example.com', here)).toBe('https://jellyfin.example.com/web/');
    expect(qrBase('https://example.com/jellyfin/', here)).toBe('https://example.com/jellyfin/web/');
  });

  it("is nothing where the page isn't served over http(s), so no QR code shows", () => {
    expect(qrBase(null, location('file:///android_asset/www/index.html'))).toBeNull();
  });

  it('points at the approve page with the code', () => {
    expect(approveUrl('https://jf.example/web/', '123456')).toBe(
      'https://jf.example/web/#/quickconnect?code=123456',
    );
  });

  it("reads the setting from the server's meta tag, if it's http(s)", () => {
    expect(publicAddressSetting(document)).toBeNull();
    const meta = document.createElement('meta');
    meta.name = 'lumen-quick-connect-address';
    meta.content = 'https://jellyfin.example.com';
    document.head.appendChild(meta);
    expect(publicAddressSetting(document)).toBe('https://jellyfin.example.com');
    meta.content = 'javascript:alert(1)';
    expect(publicAddressSetting(document)).toBeNull();
  });
});

describe('createSignInFlow', () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'hidden');
  });

  const response = (status: number) => Object.assign(new Response(null, { status }));

  function setup(connect: SignInApi['connect']) {
    vi.useFakeTimers();
    let n = 0;
    const api = {
      initiate: vi.fn(async () => ({ Secret: `secret${++n}`, Code: `10000${n}` })),
      connect: vi.fn(connect),
    };
    const states: SignInState[] = [];
    const onApproved = vi.fn(async () => undefined);
    const flow = createSignInFlow({ api, onState: (s) => states.push(s), onApproved });
    return { api, states, onApproved, flow, last: () => states[states.length - 1] };
  }

  it('shows a code, asks every few seconds, and signs in with the secret once approved', async () => {
    let approved = false;
    const { api, flow, last, onApproved } = setup(async () => ({ Authenticated: approved }));
    flow.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toEqual({ kind: 'code', code: '100001' });
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(api.connect).toHaveBeenCalledTimes(2);
    expect(api.connect).toHaveBeenCalledWith('secret1');
    approved = true;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(last()).toEqual({ kind: 'signingIn' });
    expect(onApproved).toHaveBeenCalledWith('secret1');
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(api.connect).toHaveBeenCalledTimes(3);
  });

  it('gets a new code when the server says the old one is gone, twice, then stops and offers another', async () => {
    const { api, flow, states, last } = setup(async () => Promise.reject(response(404)));
    flow.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < MAX_REFRESHES; i++) await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.initiate).toHaveBeenCalledTimes(1 + MAX_REFRESHES);
    expect(states.filter((s) => s.kind === 'code').map((s) => (s as { code: string }).code)).toEqual([
      '100001',
      '100002',
      '100003',
    ]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(last()).toEqual({ kind: 'expired' });
    // Nothing more is asked once it stopped.
    const asked = api.connect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(api.connect).toHaveBeenCalledTimes(asked);
    expect(api.initiate).toHaveBeenCalledTimes(3);
    // "Get a new code" starts over, with its two refreshes again.
    flow.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toEqual({ kind: 'code', code: '100004' });
  });

  it('keeps asking through a blip (no answer, a 5xx), and never times the code itself', async () => {
    const { api, flow, last } = setup(async () => Promise.reject(new TypeError('Failed to fetch')));
    flow.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(last()).toEqual({ kind: 'code', code: '100001' });
    expect(api.initiate).toHaveBeenCalledTimes(1);
    expect(api.connect.mock.calls.length).toBeGreaterThan(200);
  });

  it('says Quick Connect is off on a 401, at the start or later', async () => {
    const a = setup(async () => Promise.reject(response(401)));
    a.flow.start();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(a.last()).toEqual({ kind: 'disabled' });
    a.flow.stop();
    vi.useRealTimers();

    const b = setup(async () => ({}));
    b.api.initiate.mockRejectedValueOnce(response(401));
    b.flow.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.last()).toEqual({ kind: 'disabled' });
    b.api.initiate.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    b.flow.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.last()).toEqual({ kind: 'failed' });
  });

  it('stops for good: no more requests, and a late answer is ignored', async () => {
    let answer: (value: { Authenticated: boolean }) => void = () => undefined;
    const { api, flow, states, onApproved } = setup(() => new Promise((resolve) => (answer = resolve)));
    flow.start();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.connect).toHaveBeenCalledTimes(1);
    const before = states.length;
    flow.stop();
    answer({ Authenticated: true });
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(api.connect).toHaveBeenCalledTimes(1);
    expect(onApproved).not.toHaveBeenCalled();
    expect(states).toHaveLength(before);
  });

  it('pauses while the page is hidden, and asks as soon as it shows again', async () => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    const { api, flow } = setup(async () => ({ Authenticated: false }));
    flow.start();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.connect).toHaveBeenCalledTimes(1);
    hidden = true;
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(api.connect).toHaveBeenCalledTimes(1);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.connect).toHaveBeenCalledTimes(2);
    flow.stop();
  });
});
