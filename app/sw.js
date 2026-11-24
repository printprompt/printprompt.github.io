// PrintPrompt web: rende il sito installabile e lo apre anche con rete debole.
// Le pagine del sito si prendono prima dalla rete (sempre aggiornate) e, se manca, dalla copia salvata.
// I dati (Supabase) e le mappe non vengono mai salvati qui.
const CACHE = "printprompt-web-v3";
const SHELL = ["./", "./index.html", "./app.css", "./app.js", "./config.js", "./i18n.js", "../icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // solo i file del sito
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});
