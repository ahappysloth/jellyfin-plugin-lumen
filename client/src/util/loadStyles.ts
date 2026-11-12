/**
 * Lumen's stylesheets that come with a file loaded later (the player's controls, the pages in views/secondary), linked
 * the first time they're needed. They sit next to lumen.css and carry its version (the server's link to lumen.css has
 * `?v=`), so the browser caches them for good, as it does lumen.css. Resolves once the rules apply, so a view can wait
 * for them and never show unstyled; rejects if the file can't load, and asks again next time.
 */
const sheets = new Map<string, Promise<void>>();

export function loadStyles(name: string, doc: Document = document): Promise<void> {
  let sheet = sheets.get(name);
  if (sheet) return sheet;
  sheet = new Promise<void>((resolve, reject) => {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = stylesheetUrl(name, doc);
    link.onload = () => resolve();
    link.onerror = () => {
      link.remove();
      sheets.delete(name);
      reject(new Error(`couldn't load ${name}`));
    };
    doc.head.appendChild(link);
  });
  sheets.set(name, sheet);
  return sheet;
}

/** `name` beside the core file (which is beside lumen.css), with lumen.css's version. */
export function stylesheetUrl(name: string, doc: Document = document): string {
  const url = new URL(name, import.meta.url);
  const core = doc.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="lumen.css"]');
  if (core) url.search = new URL(core.href, doc.baseURI).search;
  return url.href;
}
