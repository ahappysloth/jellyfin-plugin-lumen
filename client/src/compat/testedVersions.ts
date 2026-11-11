import tested from './tested-jellyfin.json';

/**
 * Jellyfin releases (major.minor) Lumen's E2E suite has passed on. Lumen still runs on others; nothing is gated, but
 * Diagnostics mark them "untested". The nightly job (.github/workflows/e2e.yml) warns when the suite passes on a release
 * missing from tested-jellyfin.json: add it there (docs/development.md). The file holds only the list, since it ships
 * in the bundle; JSON has no comments, so this is its note.
 */
export const TESTED_JELLYFIN: readonly string[] = tested.versions;

/** "12.2" for "12.2.0"; null when the version can't be parsed. */
export function majorMinor(version: string): string | null {
  return /^(\d+)\.(\d+)/.exec(version)?.slice(1, 3).join('.') ?? null;
}

export function isTestedVersion(version: string): boolean {
  const release = majorMinor(version);
  return release !== null && TESTED_JELLYFIN.includes(release);
}

/** The server version for diagnostics, flagged when Lumen hasn't been tested on it: "12.5.0 (untested)". */
export function describeServerVersion(version: string): string {
  return isTestedVersion(version) ? version : `${version} (untested)`;
}
