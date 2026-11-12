// Service worker simples: sempre tenta a rede primeiro (o jogo atualiza sozinho) e usa o cache só se estiver offline.
const CACHE = 'entrega-maluca-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || !r.url.startsWith(self.location.origin)) return; // WebSocket e outros domínios passam direto
  e.respondWith(
    fetch(r)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(r, copia));
        return res;
      })
      .catch(() => caches.match(r).then((m) => m || caches.match('/'))),
  );
});
