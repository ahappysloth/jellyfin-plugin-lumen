import definerSource from '../src/compat/webPluginDefiner.js?raw';

/** The ES5 definer's source, exactly as the server inlines it. */
export const DEFINER_SOURCE = definerSource;

/** Runs the definer as the inline script would, against `win` (its `window`). */
export function runDefiner(win: Window): void {
  new Function('window', definerSource)(win);
}

type Callback = (e: { type: string }, ...args: unknown[]) => void;

/** jellyfin-web's utils/events.ts (the same in 10.11.11, 12.1 and 12.4): callbacks live on the object. */
export function createEvents() {
  const callbacks = (obj: Record<string, unknown>, type: string): Callback[] => {
    const all = (obj._callbacks ??= {}) as Record<string, Callback[]>;
    return (all[type] ??= []);
  };
  return {
    on: (obj: object, type: string, fn: Callback) =>
      void callbacks(obj as Record<string, unknown>, type).push(fn),
    off: (obj: object, type: string, fn: Callback) => {
      const list = callbacks(obj as Record<string, unknown>, type);
      if (list.indexOf(fn) !== -1) list.splice(list.indexOf(fn), 1);
    },
    trigger(obj: object, type: string, args: unknown[] = []) {
      for (const fn of callbacks(obj as Record<string, unknown>, type).slice(0))
        fn.apply(obj, [{ type }, ...args]);
    },
  };
}

interface Plugin {
  id: string;
  type: string;
  priority?: number;
}

/**
 * jellyfin-web's pluginManager (components/pluginManager.js, the same in 10.11.11, 12.1 and 12.4), reduced to what
 * matters here: loadPlugin constructs a window plugin with its deps and registers it in the same synchronous run,
 * triggering `registered` on itself; firstOfType is how its UI finds the SyncPlay plugin.
 */
export function createPluginManager(events: ReturnType<typeof createEvents>) {
  const pluginManager = {
    pluginsList: [] as Plugin[],
    async loadPlugin(win: Window, spec: string | Plugin, deps: object = {}) {
      let plugin: Plugin;
      if (typeof spec === 'string') {
        const definition = await (win as unknown as Record<string, () => unknown>)[spec]!;
        const PluginClass = (await definition()) as new (d: object) => Plugin;
        plugin = new PluginClass({ events, ...deps });
      } else {
        plugin = spec;
      }
      pluginManager.pluginsList.push(plugin);
      events.trigger(pluginManager, 'registered', [plugin]);
      return plugin;
    },
    ofType: (type: string) => pluginManager.pluginsList.filter((p) => p.type === type),
    firstOfType: (type: string) =>
      pluginManager.ofType(type).sort((a, b) => (a.priority || 0) - (b.priority || 0))[0],
  };
  return pluginManager;
}
