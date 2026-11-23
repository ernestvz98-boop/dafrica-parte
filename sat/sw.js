// DAFRICA SAT · la aplicación abre sin conexión. Primero la red (para recibir las versiones nuevas) y, sin red, la copia.
// Los datos (Supabase) nunca pasan por aquí: los borradores y archivos están en IndexedDB.
// El lector de albaranes (../albaranes/*.js y ../vendor/tesseract, unos 9 MB) se guarda la primera vez que se usa.
const CACHE = "dafrica-sat-0.3.14";
const BASE = [
  "./", "index.html", "app.css?v=0.3.14", "app.js?v=0.3.14", "admin.js", "manifest.webmanifest", "vendor/pdf-lib.min.js",
  "lib/config.js", "lib/api.js", "lib/almacen.js", "lib/cola.js", "lib/dictado.js", "lib/contenido.js", "lib/economia.js",
  "lib/medios.js", "lib/pdf.js", "lib/ui.js", "lib/lector-foto.js", "lib/materiales-albaran.js", "../dafrica-logo.png.png",
];
self.addEventListener("install", (e) => {
  // `reload`: la copia sin conexión se llena con los ficheros del servidor, nunca con los de la caché del navegador.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE.map((u) => new Request(u, {cache: "reload"})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("dafrica-sat-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // `no-cache`: siempre se pregunta al servidor si hay versión nueva (si no la hay, responde 304 sin descargar).
  // Sin esto, GitHub Pages deja cada fichero hasta 10 min en la caché del navegador y, tras publicar, se mezclaban
  // ficheros nuevos y viejos («does not provide an export named …», visto el 2026-11-18).
  e.respondWith(fetch(url.href, {cache: "no-cache", credentials: "same-origin"}).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: false}).then((r) => r || caches.match(e.request, {ignoreSearch: true}))
    .then((r) => r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
