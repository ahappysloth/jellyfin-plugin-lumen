// Lumen's jellyfin-web plugin (see webPlugin.ts). Inlined into index.html on its own: ES5 only, so it runs everywhere.
(function (w) {
  try {
    if ('LumenWebPlugin' in w) return;
    var slot = {};
    var Plugin = function (deps) {
      this.id = 'LumenWebPlugin';
      this.name = 'Lumen';
      this.type = 'lumen';
      slot.deps = deps;
    };
    w.__lmnWebPlugin = slot;
    w.LumenWebPlugin = function () {
      return Plugin;
    };
  } catch (e) {
    // never break jellyfin-web
  }
})(window);
