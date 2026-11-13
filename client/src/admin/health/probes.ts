import { isTestedVersion, majorMinor, TESTED_JELLYFIN } from '../../compat/testedVersions';
import type { HealthCheck, HealthReport } from './healthModel';

/**
 * The checks only the browser can make: what reaches it through any proxy, over which protocol, and whether the Quick
 * Connect address answers. Each gets its own short time limit, and none can fail the others.
 */

/** What Lumen's cache probe (LumenController.GetCacheProbe) sends: an unversioned Lumen file's headers, and this body. */
export const PROBE_PATH = 'Lumen/Assets/cache-probe.js';
export const PROBE_BODY = '/* lumen-cache-probe */';
export const PROBE_CACHE_CONTROL = 'no-cache';

const TIMEOUT_MS = 5000;

export interface ProbeEnv {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  location: Pick<Location, 'protocol' | 'hostname' | 'origin'>;
  /** The server's URL for an API path (ApiClient.getUrl). */
  url: (path: string, params?: Record<string, unknown>) => string;
  now: () => number;
}

export type BrowserCheck = HealthCheck & { before?: string };

/** fetch with a time limit (AbortController: Chromium 66, Safari 12.1). */
async function fetchWithin(env: ProbeEnv, url: string, init: RequestInit = {}): Promise<Response> {
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => abort?.abort(), TIMEOUT_MS);
  try {
    return await env.fetch(url, { ...init, signal: abort?.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Server: the Jellyfin version is one Lumen's tests have passed on (compat/tested-jellyfin.json). */
export function checkJellyfinVersion(version: string): BrowserCheck {
  const release = majorMinor(version) ?? version;
  const base = {
    Id: 'server.jellyfin',
    Group: 'Server',
    Title: 'Jellyfin version',
    before: 'server.update',
  } as const;
  return isTestedVersion(version)
    ? { ...base, Status: 'Ok', Message: `Lumen has been tested with Jellyfin ${release}.` }
    : {
        ...base,
        Status: 'Warning',
        Message:
          `Lumen hasn't been tested with Jellyfin ${release} yet (it has with ${TESTED_JELLYFIN.join(' and ')}). ` +
          "It should still work, and shows Jellyfin's own pages wherever something has changed. Check for a Lumen update.",
        Fix: { Label: 'Open Updates', Kind: 'setting', Target: 'updates' },
      };
}

/** A Cache-Control or Expires that lets a browser keep a file without asking the server again. */
function keepsWithoutAsking(cacheControl: string | null, expires: string | null, now: number): string | null {
  const cc = (cacheControl ?? '').toLowerCase();
  const maxAge = /(?:^|[,\s])max-age\s*=\s*"?(\d+)/.exec(cc);
  if (/\bno-cache\b|\bno-store\b/.test(cc) && !(maxAge && Number(maxAge[1]) > 0)) return null;
  if (maxAge && Number(maxAge[1]) > 0) return `max-age=${maxAge[1]}`;
  if (/\bimmutable\b/.test(cc)) return 'immutable';
  if (expires) {
    const at = Date.parse(expires);
    if (!Number.isNaN(at) && at > now) return 'an Expires date in the future';
  }
  // No caching headers at all: browsers may then guess a lifetime of their own (heuristic freshness).
  return cc ? null : 'no Cache-Control at all';
}

function describeLifetime(cacheControl: string | null, expires: string | null, now: number): string {
  const maxAge = /max-age\s*=\s*"?(\d+)/i.exec(cacheControl ?? '');
  const seconds = maxAge ? Number(maxAge[1]) : expires ? (Date.parse(expires) - now) / 1000 : NaN;
  if (!(seconds > 0)) return '';
  const hours = seconds / 3600;
  return hours >= 48
    ? ` (about ${Math.round(hours / 24)} days)`
    : hours >= 1
      ? ` (about ${Math.round(hours)} hours)`
      : ` (about ${Math.max(1, Math.round(seconds / 60))} minutes)`;
}

/**
 * Proxy and network: a proxy isn't caching Lumen's files too long. Fetches the cache probe, which Lumen sends like its
 * unversioned files (`Cache-Control: no-cache`, no Expires), and compares what arrives. Nginx Proxy Manager's "Cache
 * Assets" replaces them with a long max-age and Expires for anything ending in .js or .css, so after a Lumen update
 * browsers keep running the old files. With no proxy, the headers arrive as sent.
 */
export async function checkProxyCache(env: ProbeEnv): Promise<BrowserCheck> {
  const base = { Id: 'proxy.cache', Group: 'Proxy', Title: "Caching of Lumen's files" } as const;
  let response: Response;
  let body: string;
  try {
    // A new address each time, so neither this browser's cache nor a proxy's answers in Lumen's place.
    response = await fetchWithin(env, env.url(PROBE_PATH, { t: env.now() }), {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    body = await response.text();
  } catch {
    return { ...base, Status: 'NotApplicable', Message: "Couldn't check: the test file didn't arrive." };
  }
  if (!response.ok || body.trim() !== PROBE_BODY)
    return {
      ...base,
      Status: 'NotApplicable',
      Message: `Couldn't check: the test file came back as something else (HTTP ${response.status}).`,
    };

  const cacheControl = response.headers.get('Cache-Control');
  const expires = response.headers.get('Expires');
  const received = `Received: Cache-Control: ${cacheControl ?? '(none)'}${expires ? `; Expires: ${expires}` : ''}.`;
  const kept = keepsWithoutAsking(cacheControl, expires, env.now());
  if (!kept)
    return {
      ...base,
      Status: 'Ok',
      Message:
        "Lumen's files arrive with the caching headers Lumen sends, so browsers pick up a Lumen update at once.",
      Detail: received,
    };
  return {
    ...base,
    Status: 'Problem',
    Message:
      `Something between Jellyfin and this browser (a reverse proxy or CDN) changes how long Lumen's files are kept: Lumen ` +
      `sends "Cache-Control: ${PROBE_CACHE_CONTROL}", but they arrive with ${kept}${describeLifetime(cacheControl, expires, env.now())}. ` +
      'After a Lumen update, browsers keep running the old files and pages can break until that runs out. In Nginx ' +
      'Proxy Manager, turn off "Cache Assets" for this host; with another proxy, leave the caching headers of /Lumen/ ' +
      'and /web/ as Jellyfin sends them.',
    Detail: received,
  };
}

/**
 * Who reaches a hostname: only this machine (localhost), this home network (a private IP, a name with no dots, .local),
 * a private network across the internet (Tailscale: its 100.64.0.0/10 addresses, which are also carriers' shared NAT
 * range, and its *.ts.net names, which plain HTTP reaches only inside the tailnet), or anyone.
 */
export function addressKind(hostname: string): 'loopback' | 'local' | 'private' | 'public' {
  const host = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '::1')
    return 'loopback';
  if (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^(fc|fd)[0-9a-f]{2}:/.test(host) ||
    /^fe80:/.test(host) ||
    /\.(local|lan|home|internal|home\.arpa)$/.test(host) ||
    // A one-word name (an IPv6 address has colons instead of dots).
    (!host.includes('.') && !host.includes(':'))
  )
    return 'local';
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) || /\.ts\.net$/.test(host)) return 'private';
  return 'public';
}

/** Proxy and network: the page came over HTTPS (installing as an app, and other secure-only browser features, need it). */
export function checkHttps(location: ProbeEnv['location']): BrowserCheck {
  const base = { Id: 'proxy.https', Group: 'Proxy', Title: 'HTTPS' } as const;
  if (location.protocol === 'https:')
    return {
      ...base,
      Status: 'Ok',
      Message: 'This page came over HTTPS, which installing Lumen as an app on a phone or computer needs.',
    };
  const kind = addressKind(location.hostname);
  if (kind === 'loopback')
    return {
      ...base,
      Status: 'NotApplicable',
      Message:
        "This page is open on this computer's own address (localhost), where browsers don't need HTTPS. Other devices need an HTTPS address to install Lumen as an app.",
    };
  if (kind === 'private')
    return {
      ...base,
      Status: 'NotApplicable',
      Message:
        'This page came over plain HTTP from a private network address (such as Tailscale), which only devices on that network reach. Installing Lumen as an app on a phone or computer needs an HTTPS address (Tailscale can give one).',
    };
  if (kind === 'local')
    return {
      ...base,
      Status: 'NotApplicable',
      Message:
        'This page came over plain HTTP from a local address. That works at home, but installing Lumen as an app on a phone or computer needs an HTTPS address (usually a reverse proxy).',
    };
  return {
    ...base,
    Status: 'Problem',
    Message:
      "This page came over plain HTTP from a public address: passwords and sign-ins cross the internet unencrypted, and Lumen can't be installed as an app. Put Jellyfin behind HTTPS (a reverse proxy with a certificate).",
  };
}

/**
 * Notifications: browsers only let a page turn on notifications over HTTPS (or on localhost, for that computer alone),
 * and iOS only in the Home Screen app. This page's address is the one checked: users may come in through another.
 */
export function checkPushAddress(
  location: ProbeEnv['location'],
  report: Pick<HealthReport, 'Checks'>,
): BrowserCheck {
  const base = {
    Id: 'notifications.https',
    Group: 'Notifications',
    Title: 'HTTPS for notifications',
    before: 'notifications.devices',
  } as const;
  const service = report.Checks.find((c) => c.Id === 'notifications.service');
  if (!service || service.Status === 'NotApplicable')
    return {
      ...base,
      Status: 'NotApplicable',
      Message: service?.Message ?? 'Notifications come with requests, which are off.',
    };
  if (location.protocol === 'https:')
    return {
      ...base,
      Status: 'Ok',
      Message:
        'This address is HTTPS, which notifications need. On an iPhone or iPad they also need Lumen on the Home Screen (iOS 16.4 or later), and are turned on in that app.',
    };
  const kind = addressKind(location.hostname);
  if (kind === 'loopback')
    return {
      ...base,
      Status: 'NotApplicable',
      Message:
        'Browsers allow notifications on localhost, but only on this computer: other devices need an HTTPS address to turn them on.',
    };
  const plain =
    'This page came over plain HTTP, and browsers allow notifications only over HTTPS, so devices that reach Jellyfin at this address can’t turn them on.';
  return kind === 'public'
    ? {
        ...base,
        Status: 'Warning',
        Message: `${plain} Put Jellyfin behind HTTPS (a reverse proxy with a certificate).`,
      }
    : {
        ...base,
        Status: 'NotApplicable',
        Message: `${plain} Users who reach Jellyfin through an HTTPS address can turn them on there.`,
      };
}

/**
 * Quick Connect: the "Public address for QR codes" answers, and it's this server. A browser only lets a page read
 * another address's answer when that server allows it (Jellyfin does, but a proxy may not, and an HTTP address from an
 * HTTPS page is blocked), so a failure at another address only means it can't be checked from here.
 */
export async function checkQuickConnectAddress(
  env: ProbeEnv,
  report: Pick<HealthReport, 'QuickConnectAddress' | 'Checks'>,
): Promise<BrowserCheck> {
  const base = {
    Id: 'quickConnect.reachable',
    Group: 'QuickConnect',
    Title: 'Public address answers',
  } as const;
  const enabled = report.Checks.find((c) => c.Id === 'quickConnect.enabled');
  if (enabled && enabled.Status !== 'Ok')
    return { ...base, Status: 'NotApplicable', Message: 'Quick Connect is off.' };
  const address = report.QuickConnectAddress.trim().replace(/\/+$/, '');
  if (!address)
    return {
      ...base,
      Status: 'NotApplicable',
      Message: 'No public address is set, so there is nothing more to check.',
    };

  let origin: string;
  try {
    origin = new URL(address).origin;
  } catch {
    return {
      ...base,
      Status: 'Problem',
      Message: "The public address isn't a web address.",
      Detail: address,
    };
  }
  const readId = async (url: string): Promise<string | null> => {
    const response = await fetchWithin(env, url, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return null;
    return ((await response.json()) as { Id?: string }).Id ?? null;
  };
  const sameOrigin = origin === env.location.origin;
  const [theirs, ours] = await Promise.all([
    readId(`${address}/System/Info/Public`).catch(() => undefined),
    readId(env.url('System/Info/Public')).catch(() => null),
  ]);
  if (theirs === undefined || theirs === null)
    return sameOrigin
      ? {
          ...base,
          Status: 'Problem',
          Message:
            "The public address doesn't answer like a Jellyfin server, so phones that scan the QR code can't reach it.",
          Detail: `Tried ${address}.`,
        }
      : {
          ...base,
          Status: 'NotApplicable',
          Message:
            "Can't check from here: the public address isn't this page's, and the browser won't let this page read its answer. Open it on a phone to check it.",
          Detail: `Tried ${address}.`,
        };
  // This server's own id didn't load: the address answers, but whether it's this server can't be told.
  if (!ours)
    return {
      ...base,
      Status: 'Ok',
      Message:
        "The public address answers like a Jellyfin server. Whether it's this one couldn't be checked: this server's own details didn't load. Run the checks again to compare.",
      Detail: `Checked ${address}.`,
    };
  if (theirs.replace(/-/g, '').toLowerCase() !== ours.replace(/-/g, '').toLowerCase())
    return {
      ...base,
      Status: 'Warning',
      Message:
        "The public address answers, but it's a different Jellyfin server: phones that scan the QR code would sign in there.",
      Detail: `Tried ${address}.`,
    };
  return {
    ...base,
    Status: 'Ok',
    Message: "The public address answers, and it's this server.",
    Detail: `Checked ${address}.`,
  };
}

/** Every browser-side check, in parallel. */
export async function runBrowserChecks(env: ProbeEnv, report: HealthReport): Promise<BrowserCheck[]> {
  const [cache, quickConnect] = await Promise.all([
    checkProxyCache(env),
    checkQuickConnectAddress(env, report),
  ]);
  return [
    checkJellyfinVersion(report.JellyfinVersion),
    cache,
    checkHttps(env.location),
    checkPushAddress(env.location, report),
    quickConnect,
  ];
}
