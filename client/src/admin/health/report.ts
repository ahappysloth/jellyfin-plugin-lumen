import type { DeviceRow } from './devices';
import { type HealthCheck, type HealthGroup, STATUS_TEXT } from './healthModel';

/**
 * The plain-text report "Copy report" puts on the clipboard, to paste into a bug report. It must hold no secret: no API
 * key, token, webhook secret or VAPID key, and no address. The checks' messages are written without them (the server's
 * and probes.ts'); page-only details (HealthCheck.Detail) are left out; settings are reduced to set / not set; and the
 * whole text goes through redact() as well, against the addresses this page knows and anything shaped like one.
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
      lines.push(`- ${STATUS_TEXT[check.Status]}: ${check.Title} [${check.Id}]: ${check.Message}`);
  }
  lines.push('', 'Devices');
  if (input.devices.length === 0) lines.push('- No compatibility problems reported since Jellyfin started.');
  for (const device of input.devices) {
    lines.push(
      `- ${STATUS_TEXT[device.status]}: ${device.title}; Jellyfin ${device.serverVersion}; last seen ${utc(new Date(device.lastSeen))}`,
      `  What broke: ${device.broke.join(' ')}`,
      `  What Lumen did: ${device.did.join(' ')}`,
    );
    if (device.advice) lines.push(`  Would an update help: ${device.advice}`);
    lines.push(`  Checks: ${device.ids.join(', ')}`);
  }
  return redact(lines.join('\n'), input.secrets);
}

/**
 * Takes out of `text` each of `secrets` (and, for a URL, its host), then anything that looks like an address or a key:
 * URLs, email addresses, IP addresses, and long runs mixing letters and digits (keys, tokens, ids; not a long word like a check id).
 */
export function redact(text: string, secrets: string[]): string {
  const values: string[] = [];
  for (const secret of secrets) {
    const value = secret.trim();
    if (value.length < 3) continue;
    values.push(value);
    try {
      const url = new URL(value);
      if (url.host) values.push(url.host);
      if (url.hostname) values.push(url.hostname);
    } catch {
      // Not a URL: the value alone.
    }
  }
  let out = text;
  // Longest first, so a URL goes before its host leaves a stub of it.
  for (const value of values.sort((a, b) => b.length - a.length)) out = out.split(value).join('[redacted]');
  return out
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi, '[address]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b(\d{1,3}\.){3}\d{1,3}(:\d+)?\b/g, '[address]')
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b/g, '[redacted]');
}

/** The groups' order in the report follows the page's. */
export type ReportGroups = { id: HealthGroup; label: string; checks: HealthCheck[] }[];
