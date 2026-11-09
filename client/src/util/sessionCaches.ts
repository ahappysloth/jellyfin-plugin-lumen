/**
 * Caches that belong to one signed-in session register here; the bootstrap clears them all when the session ends
 * (sign out, another user, another server), so nothing a previous user saw or could do leaks into the next session.
 */
const resets = new Set<() => void>();

export function registerSessionCache(reset: () => void): void {
  resets.add(reset);
}

export function resetSessionCaches(): void {
  resets.forEach((reset) => reset());
}
