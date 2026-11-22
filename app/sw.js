// Offline-Fähigkeit: App-Dateien werden auf dem Handy zwischengespeichert.
const CACHE = "airtec-kapp-v23";
const FILES = ["/", "/index.html", "/manifest.webmanifest", "/apple-touch-icon.png", "/login.js", "/wochenplan.js", "/austausch.js", "/allgemein.js", "/autos.js", "/hinweise.js", "/urlaub.js", "/krank.js", "/maschinen.js", "/lager.js", "/admin.js", "/icon-192.png",
  "/qr.js", "/logbuch.js", "/typenschild.js", "/push.js", "/leitern.js",
  "/vendor/jspdf.umd.min.js", "/vendor/jspdf.plugin.autotable.min.js", "/vendor/xlsx.full.min.js", "/vendor/jsQR.js"];
const APP = ["/", "/index.html", "/login.js", "/wochenplan.js", "/krank.js", "/hinweise.js", "/maschinen.js", "/lager.js", "/admin.js", "/austausch.js", "/urlaub.js", "/autos.js", "/allgemein.js",
  "/qr.js", "/logbuch.js", "/typenschild.js", "/push.js", "/leitern.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))); self.clients.claim(); });
// Handy-Mitteilungen (lib/push.js): anzeigen, Punkt am App-Symbol, Tipp öffnet die App am richtigen Reiter
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { text: e.data ? e.data.text() : "" }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.titel || "Airtec KApp", { body: d.text || "", icon: "/icon-192.png", badge: "/icon-192.png",
      tag: d.tag || undefined, renotify: !!d.tag, data: { ziel: d.ziel || "start" } }),
    self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge().catch(() => {}) : null,
  ]));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const ziel = (e.notification.data && e.notification.data.ziel) || "start";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const c = list.find(x => new URL(x.url).origin === location.origin);
    if (c) { c.postMessage({ typ: "mitteilung", ziel }); return c.focus(); }
    return self.clients.openWindow("/?ziel=" + encodeURIComponent(ziel));
  }));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  // App selbst: erst Netz (Updates), sonst Cache. Bibliotheken: erst Cache.
  if (APP.includes(u.pathname)) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("/index.html"))));
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
