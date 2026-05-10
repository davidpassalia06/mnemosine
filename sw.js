// ─── Mnemosyne Service Worker ───────────────────────────────────────────────
// Aggiorna CACHE_VERSION ad ogni release per invalidare la cache vecchia.
// Il numero viene letto dall'HTML tramite <meta name="sw-version">.
const CACHE_VERSION = 'v1';
const CACHE_NAME    = `mnemosyne-${CACHE_VERSION}`;

// Asset locali — messi in cache al primo avvio
const LOCAL_ASSETS = [
  './',
  './index.html',
  './css/master.css',
  './js/script.js',
  './manifest.json',
];

// Asset CDN — messi in cache al primo fetch, poi cache-first
const CDN_ORIGINS = [
  'https://cdn.jsdelivr.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// ─── Install: precache asset locali ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(LOCAL_ASSETS))
      .then(() => self.skipWaiting())   // attiva subito senza aspettare reload
  );
});

// ─── Activate: elimina cache di versioni precedenti ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('mnemosyne-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())  // prende controllo di tutte le tab aperte
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora richieste non-GET e chrome-extension ecc.
  if (request.method !== 'GET') return;
  if (!['http:', 'https:'].includes(url.protocol)) return;

  const isCDN   = CDN_ORIGINS.some(o => request.url.startsWith(o));
  const isLocal = url.origin === self.location.origin;

  if (isLocal) {
    // ── Strategia locale: Cache First, fallback network ──────────────────────
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        });
      })
    );
  } else if (isCDN) {
    // ── Strategia CDN: Cache First, fallback network ─────────────────────────
    // I CDN hanno URL stabili con versione — va bene restare in cache a lungo.
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
  }
  // Tutto il resto (es. analytics, avatar) passa senza intercettare
});

// ─── Messaggio per forzare aggiornamento dalla UI ────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
