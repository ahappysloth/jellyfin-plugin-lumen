/** Reloads the page. Its own module so tests can stand in for it (jsdom's location.reload can't be replaced). */
export function reloadPage(): void {
  window.location.reload();
}

/**
 * Reloads the page only if the server answers. Offline, or while Jellyfin restarts, a reload would land on the
 * browser's own error page, and a home-screen app has no reload button to get back: better to stay on Lumen's error
 * page. Resolves whether it reloaded.
 */
export async function reloadIfReachable(timeoutMs = 5000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    // index.html is served from <base>/web/, so the server's API is one level up (behind a base URL too).
    const response = await fetch('../System/Info/Public', { cache: 'no-store', signal: controller?.signal });
    if (!response.ok) return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
  reloadPage();
  return true;
}
