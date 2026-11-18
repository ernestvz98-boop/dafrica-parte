// DAFRICA SAT · la aplicación abre sin conexión. Primero la red (para recibir las versiones nuevas) y, sin red, la copia.
// Los datos (Supabase) nunca pasan por aquí: los borradores y archivos están en IndexedDB.
// El lector de albaranes (../albaranes/*.js y ../vendor/tesseract, unos 9 MB) se guarda la primera vez que se usa.
const CACHE = "dafrica-sat-0.3.0";
const BASE = [
  "./", "index.html", "app.css?v=0.3.0", "app.js?v=0.3.0", "admin.js", "manifest.webmanifest", "vendor/pdf-lib.min.js",
  "lib/config.js", "lib/api.js", "lib/almacen.js", "lib/cola.js", "lib/dictado.js", "lib/contenido.js", "lib/economia.js",
  "lib/medios.js", "lib/pdf.js", "lib/ui.js", "lib/lector-foto.js", "lib/materiales-albaran.js", "../dafrica-logo.png.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("dafrica-sat-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: false}).then((r) => r || caches.match(e.request, {ignoreSearch: true}))
    .then((r) => r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
