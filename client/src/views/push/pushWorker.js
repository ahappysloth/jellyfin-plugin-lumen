// Lumen's service worker: shows the notifications the server pushes ("Dune is ready to watch") and opens Lumen when
// one is tapped, with the app closed too (web push design note, 2026-11-12).
//
// It is served at <server>/Lumen/Push/sw.js, so its scope is <server>/Lumen/Push/: it controls no page, caches
// nothing and never sees a request. jellyfin-web registers a worker of its own for /web/ (serviceworker.js), which
// has no push handler; the two don't meet. A browser delivers a push to the registration that subscribed, whatever
// pages it controls.
//
// Copied to dist/lumen-push-sw.js as it is, not built (scripts/copy-web-plugin.mjs): plain ES5, no imports. The
// routes below are jellyfin-web's and Lumen's, as in compat/registry.ts; pushWorker.test.ts checks they still match.
(function () {
  'use strict';

  // The server's base address, under any base URL: …/Lumen/Push/sw.js → …/
  var BASE = new URL('../../', self.location.href).href;
  var APP = BASE + 'web/';
  var ROUTES = {
    item: '#/details?id=',
    title: '#/home?title=',
    requests: '#/home?lumen=requests',
    home: '#/home',
  };
  var ICON = 'Lumen/Assets/lumen-icon-192.png';
  // Shown if a message can't be read: a push must always show something, or the browser withdraws the permission
  // (Safari after a few, Chrome shows its own "updated in the background").
  var FALLBACK_TITLE = 'Lumen';
  var FALLBACK_BODY = 'Something you requested is ready to watch.';

  function text(value) {
    return typeof value === 'string' ? value : '';
  }

  /** The page a message opens: the title in the library, its catalog page, or My requests. */
  function hashFor(data) {
    if (text(data.item)) return ROUTES.item + encodeURIComponent(data.item);
    if (text(data.key)) return ROUTES.title + encodeURIComponent(data.key);
    return data.page === 'requests' ? ROUTES.requests : ROUTES.home;
  }

  /** A path the server sent, under its base; never another origin. */
  function local(path) {
    if (!text(path)) return undefined;
    try {
      var url = new URL(path, BASE);
      return url.href.indexOf(BASE) === 0 ? url.href : undefined;
    } catch (e) {
      return undefined;
    }
  }

  function read(event) {
    try {
      var data = event.data ? event.data.json() : null;
      return data && typeof data === 'object' ? data : {};
    } catch (e) {
      return {};
    }
  }

  // A new version takes over at once: there are no pages to keep consistent with the old one.
  self.addEventListener('install', function () {
    self.skipWaiting();
  });

  self.addEventListener('push', function (event) {
    var data = read(event);
    var title = text(data.title);
    var options = {
      body: title ? text(data.body) : FALLBACK_BODY,
      icon: local(text(data.icon) || ICON),
      data: { hash: hashFor(data) },
    };
    // One notification per title: a second message about it replaces the first.
    if (text(data.tag)) options.tag = data.tag;
    // The artwork, where the platform shows pictures (not iOS, which ignores it).
    if (local(data.image)) options.image = local(data.image);
    event.waitUntil(self.registration.showNotification(title || FALLBACK_TITLE, options));
  });

  self.addEventListener('notificationclick', function (event) {
    var hash = (event.notification.data && text(event.notification.data.hash)) || ROUTES.home;
    event.notification.close();
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
        var app = null;
        for (var i = 0; i < windows.length; i++) {
          if (windows[i].url.indexOf(APP) === 0 && (!app || windows[i].focused)) app = windows[i];
        }
        // Lumen is open: bring it forward and have it go to the page (views/push/push.ts listens). This worker doesn't
        // control the page, so it can't navigate it itself.
        if (app && app.focus) {
          app.postMessage({ type: 'lumen-push-open', hash: hash });
          return app.focus().catch(function () {
            return self.clients.openWindow(APP + 'index.html' + hash);
          });
        }
        return self.clients.openWindow(APP + 'index.html' + hash);
      }),
    );
  });
})();
