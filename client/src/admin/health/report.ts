import type { DeviceRow } from './devices';
import { type HealthCheck, type HealthGroup, STATUS_TEXT } from './healthModel';
import { addressKind } from './probes';

/**
 * The plain-text report "Copy report" puts on the clipboard, to paste into a bug report. It must hold no secret: no API
 * key, token, webhook secret or VAPID key, and no address. The checks' messages are written without them (the server's
 * and probes.ts'); page-only details (HealthCheck.Detail) are left out; settings are reduced to set / not set; and what
 * came from elsewhere (the checks' messages, which can quote an error, and what devices reported) goes through redact()
 * as well, against the addresses this page knows and anything shaped like one. The report's own words don't: a host
 * named like one of them ("localhost", "jellyfin") would otherwise eat into them.
 */

/** What the report says about the settings: only whether each is set. */
export interface ReportSettings {
  requestsEnabled: boolean;
  seerrAddressSet: boolean;
  seerrKeySet: boolean;
  traktKeySet: boolean;
  quickConnectAddressSet: boolean;
}

export interface ReportInput {
  checkedAt: Date;
  lumenVersion: string;
  jellyfinVersion: string;
  groups: { label: string; checks: HealthCheck[] }[];
  devices: DeviceRow[];
  settings: ReportSettings;
  /** Addresses and values to take out wherever they appear (Seerr's address, the public address, this page's host). */
  secrets: string[];
}

const setOrNot = (value: boolean): string => (value ? 'set' : 'not set');

/** "2026-11-12 14:03 UTC": the same for whoever reads the report. */
function utc(date: Date): string {
  return Number.isNaN(date.getTime())
    ? 'unknown'
    : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function buildReport(input: ReportInput): string {
  const clean = (text: string): string => redact(text, input.secrets);
  const lines = [
    'Lumen health report',
    `Checked: ${utc(input.checkedAt)}`,
    `Lumen ${input.lumenVersion}, Jellyfin ${input.jellyfinVersion}`,
    '',
    'Settings',
    `- Requests: ${input.settings.requestsEnabled ? 'on' : 'off'}; Seerr address ${setOrNot(input.settings.seerrAddressSet)}, API key ${setOrNot(input.settings.seerrKeySet)}`,
    `- Trakt key: ${setOrNot(input.settings.traktKeySet)}`,
    `- Public address for QR codes: ${setOrNot(input.settings.quickConnectAddressSet)}`,
  ];
  for (const group of input.groups) {
    lines.push('', group.label);
    for (const check of group.checks)
      lines.push(`- ${STATUS_TEXT[check.Status]}: ${check.Title} [${check.Id}]: ${clean(check.Message)}`);
  }
  lines.push('', 'Devices');
  if (input.devices.length === 0) lines.push('- No compatibility problems reported since Jellyfin started.');
  for (const device of input.devices) {
    lines.push(
      `- ${STATUS_TEXT[device.status]}: ${clean(device.title)}; Jellyfin ${clean(device.serverVersion)}; last seen ${utc(new Date(device.lastSeen))}`,
      `  What broke: ${clean(device.broke.join(' '))}`,
      `  What Lumen did: ${clean(device.did.join(' '))}`,
    );
    if (device.advice) lines.push(`  Would an update help: ${clean(device.advice)}`);
    lines.push(`  Checks: ${clean(device.ids.join(', '))}`);
  }
  return lines.join('\n');
}

/** The host a secret names: a URL's, or a bare "host:port"'s. */
function hostOf(value: string): URL | null {
  for (const candidate of [value, `http://${value}`]) {
    try {
      const url = new URL(candidate);
      if (url.hostname) return url;
    } catch {
      // Not this way.
    }
  }
  return null;
}

/** A value as a literal inside a RegExp. */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Takes out of `text` each of `secrets` (and, for a URL, its host), then anything that looks like an address or a key:
 * URLs, email addresses, IP addresses, and long runs mixing letters and digits (keys, tokens, ids; not a long word like a
 * check id). A secret goes only where it stands whole (not inside a longer name or word), and a one-word host only in
 * the case it's written in, so a server called "jellyfin" leaves "Jellyfin" alone. This computer's own address
 * (localhost) tells nobody anything, so it stays.
 */
export function redact(text: string, secrets: string[]): string {
  const values: { value: string; anyCase: boolean }[] = [];
  for (const secret of secrets) {
    const value = secret.trim();
    if (value.length < 3) continue;
    const url = hostOf(value);
    if (url && addressKind(url.hostname) === 'loopback') continue;
    values.push({ value, anyCase: true });
    if (url) {
      // URL lowercases hosts; a one-word one ("nas") is matched only as written, as hosts are.
      const dotted = /[.:]/.test(url.hostname);
      values.push({ value: url.host, anyCase: dotted }, { value: url.hostname, anyCase: dotted });
    }
  }
  let out = text;
  // Longest first, so a URL goes before its host leaves a stub of it.
  for (const { value, anyCase } of values.sort((a, b) => b.value.length - a.value.length)) {
    // No lookbehind (Safari 16.4): the character before is captured and put back.
    const pattern = new RegExp(`(^|[^\\w.-])${escapeRegExp(value)}(?![\\w-]|\\.\\w)`, anyCase ? 'gi' : 'g');
    out = out.replace(pattern, '$1[redacted]');
  }
  return out
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi, '[address]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b(\d{1,3}\.){3}\d{1,3}(:\d+)?\b/g, '[address]')
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b/g, '[redacted]');
}

/** The groups' order in the report follows the page's. */
export type ReportGroups = { id: HealthGroup; label: string; checks: HealthCheck[] }[];
