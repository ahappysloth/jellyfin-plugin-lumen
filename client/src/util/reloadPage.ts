/** Reloads the page. Its own module so tests can stand in for it (jsdom's location.reload can't be replaced). */
export function reloadPage(): void {
  window.location.reload();
}
