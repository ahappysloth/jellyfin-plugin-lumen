// Lumen's jellyfin-web plugin (see webPlugin.ts). Inlined into index.html on its own: ES5 only, so it runs everywhere.
(function (w) {
  try {
    if ('LumenWebPlugin' in w) return;
    var slot = {};
    // pluginManager isn't among the deps, but registering a plugin calls events.trigger(pluginManager, 'registered',
    // [plugin]) right after constructing it, before anything else can run. Watch that one call to keep pluginManager:
    // SyncPlay is found through it (compat/syncPlay.ts). The first call puts trigger back, whatever it is.
    var catchPluginManager = function (events, plugin) {
      var trigger = events && events.trigger;
      if (typeof trigger !== 'function') return;
      var watch = function (obj, type, args) {
        if (events.trigger === watch) events.trigger = trigger;
        if (type === 'registered' && args && args[0] === plugin) slot.pluginManager = obj;
        return trigger.apply(this, arguments);
      };
      events.trigger = watch;
    };
    var Plugin = function (deps) {
      this.id = 'LumenWebPlugin';
      this.name = 'Lumen';
      this.type = 'lumen';
      slot.deps = deps;
      try {
        catchPluginManager(deps && deps.events, this);
      } catch (e) {
        // the webpack search still finds SyncPlay
      }
    };
    w.__lmnWebPlugin = slot;
    w.LumenWebPlugin = function () {
      return Plugin;
    };
  } catch (e) {
    // never break jellyfin-web
  }
})(window);
