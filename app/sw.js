// Offline-Fähigkeit: App-Dateien werden auf dem Handy zwischengespeichert.
const CACHE = "airtec-ibn-v19";
const FILES = ["/", "/index.html", "/manifest.webmanifest", "/apple-touch-icon.png", "/login.js", "/wochenplan.js", "/hinweise.js", "/krank.js", "/maschinen.js", "/lager.js", "/icon-192.png",
  "/vendor/jspdf.umd.min.js", "/vendor/jspdf.plugin.autotable.min.js", "/vendor/xlsx.full.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  // App selbst: erst Netz (Updates), sonst Cache. Bibliotheken: erst Cache.
  if (u.pathname === "/" || u.pathname === "/index.html" || u.pathname === "/login.js" || u.pathname === "/wochenplan.js" || u.pathname === "/krank.js" || u.pathname === "/hinweise.js" || u.pathname === "/maschinen.js" || u.pathname === "/lager.js") {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("/index.html"))));
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
