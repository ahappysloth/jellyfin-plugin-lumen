/** The query that makes Lumen's settings page check for updates as it opens (shared with lumen.js's Plugins button). */
export const CHECK_UPDATES_QUERY = 'check=updates';

export function wantsCheck(hash: string): boolean {
  const query = hash.indexOf('?');
  return query >= 0 && new URLSearchParams(hash.slice(query + 1)).get('check') === 'updates';
}
