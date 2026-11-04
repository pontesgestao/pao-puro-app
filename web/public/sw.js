// Service worker: guarda o app em cache para abrir rápido e funcionar com sinal fraco.
// As chamadas /api sempre vão para a rede.
const CACHE = 'paopuro-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/logo.png', '/icon-192.png'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request.mode === 'navigate' ? '/' : e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request.mode === 'navigate' ? '/' : e.request)),
  );
});
