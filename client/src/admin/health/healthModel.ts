/**
 * The Health tab's rows: the server's checks (GET /Lumen/Admin/Health, Jellyfin.Plugin.Lumen/Health) and the ones only
 * the browser can make (probes.ts), shown together under the same groups.
 *
 * Adding a check: a server one is a class implementing IHealthCheck plus a line in ServiceRegistrator, and shows here
 * with no client change unless it's in a new group (add it to GROUPS). A browser one is a function in probes.ts, added
 * to runBrowserChecks. A fix the server names by a new key needs that key in fixes.ts.
 */

export type HealthStatus = 'Ok' | 'Warning' | 'Problem' | 'NotApplicable';

export type HealthGroup =
  'Server' | 'Proxy' | 'Requests' | 'Notifications' | 'Trakt' | 'SkipIntro' | 'QuickConnect';

/**
 * Where a row's fix is: a Dashboard page (`dashboard`), a card on Lumen's Settings tab (`setting`) or a help page
 * (`help`), each by a key (fixes.ts).
 */
export interface HealthFix {
  Label: string;
  Kind: 'dashboard' | 'setting' | 'help';
  Target: string;
}

/** One check's result. Message is plain words, and goes into the copied report: it never holds an address or secret. */
export interface HealthCheck {
  Id: string;
  Group: HealthGroup;
  Status: HealthStatus;
  Title: string;
  Message: string;
  Fix?: HealthFix | null;
  /** Shown on the page only, never copied: e.g. the address a check tried. */
  Detail?: string;
}

/** A client's compatibility report (DiagnosticEntry). */
export interface DeviceReport {
  Client: string;
  ServerVersion: string;
  FailedChecks: string[];
  LastSeen: string;
}

/** HealthReportDto. */
export interface HealthReport {
  CheckedAt: string;
  LumenVersion: string;
  JellyfinVersion: string;
  Checks: HealthCheck[];
  Devices: DeviceReport[];
  /** The saved "Public address for QR codes"; empty when not set. */
  QuickConnectAddress: string;
}

/** The groups in page order, with their headings. Devices come last, from the report's Devices. */
export const GROUPS: { id: HealthGroup; label: string }[] = [
  { id: 'Server', label: 'Server' },
  { id: 'Proxy', label: 'Proxy and network' },
  { id: 'Requests', label: 'Requests (Seerr)' },
  { id: 'Notifications', label: 'Notifications' },
  { id: 'Trakt', label: 'Trakt' },
  { id: 'SkipIntro', label: 'Skip Intro' },
  { id: 'QuickConnect', label: 'Quick Connect' },
];

/** The status in words: shown beside the icon (which screen readers skip) and used in the copied report. */
export const STATUS_TEXT: Record<HealthStatus, string> = {
  Ok: 'OK',
  Warning: 'Warning',
  Problem: 'Problem',
  NotApplicable: 'Not applicable',
};

export const STATUS_ICON: Record<HealthStatus, string> = {
  Ok: '✅',
  Warning: '⚠️',
  Problem: '❌',
  NotApplicable: '⏭',
};

/**
 * The rows of each group: the server's, then the browser's placed where they belong (`before` puts one ahead of the
 * server row it names, else it goes at the end of its group).
 */
export function groupChecks(
  server: HealthCheck[],
  browser: (HealthCheck & { before?: string })[],
): { id: HealthGroup; label: string; checks: HealthCheck[] }[] {
  return GROUPS.map((group) => {
    const rows = server.filter((c) => c.Group === group.id);
    for (const extra of browser.filter((c) => c.Group === group.id)) {
      const at = extra.before ? rows.findIndex((c) => c.Id === extra.before) : -1;
      const row: HealthCheck = { ...extra };
      delete (row as { before?: string }).before;
      if (at < 0) rows.push(row);
      else rows.splice(at, 0, row);
    }
    return { ...group, checks: rows };
  }).filter((g) => g.checks.length > 0);
}

/** How many rows are ❌ (the tab's badge). */
export function countProblems(checks: HealthCheck[]): number {
  return checks.filter((c) => c.Status === 'Problem').length;
}
