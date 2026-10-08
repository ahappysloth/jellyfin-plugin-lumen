const NAVIGATE_EVENT = 'lmn:navigate';
type HookedWindow = Window & { __lmnNavigationHooked?: boolean };

/**
 * jellyfin-web navigates with history.pushState, which fires no event. Wrap pushState/replaceState once so they
 * emit one, and also listen to popstate/hashchange. Listeners are called once per new href.
 */
export function onNavigate(listener: (href: string) => void, win: Window = window): () => void {
  installHooks(win);
  let last = win.location.href;
  const handler = (): void => {
    const href = win.location.href;
    if (href === last) return;
    last = href;
    listener(href);
  };
  const events = [NAVIGATE_EVENT, 'popstate', 'hashchange'];
  events.forEach((e) => win.addEventListener(e, handler));
  return () => events.forEach((e) => win.removeEventListener(e, handler));
}

function installHooks(win: Window): void {
  const hooked = win as HookedWindow;
  if (hooked.__lmnNavigationHooked) return;
  hooked.__lmnNavigationHooked = true;
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = win.history[method].bind(win.history);
    win.history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args);
      win.dispatchEvent(new Event(NAVIGATE_EVENT));
    };
  }
}
