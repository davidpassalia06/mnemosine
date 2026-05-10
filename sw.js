const C = 'mnemosyne-20260510c';
const EXCLUDE = /fonts\.googleapis|fonts\.gstatic/;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(C).then(c => c.addAll([
      './',
      './index.html',
      './js/script.js',
      './css/master.css',
      './manifest.json',
    ])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== C).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (EXCLUDE.test(e.request.url)) return;
  e.respondWith(
    caches.match(e.request).then(r =>
      r || fetch(e.request).then(res => {
        return caches.open(C).then(c => {
          c.put(e.request, res.clone());
          return res;
        });
      }).catch(() => caches.match('./index.html'))
    )
  );
});
