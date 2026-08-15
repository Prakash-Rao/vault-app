const CACHE_NAME = 'vault-cache-v1';
const ASSETS = [
  './index.html',
  './share.html',
  './styles.css',
  './app.js',
  './db.js',
  './sync.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Handle incoming shares (links, text, or files) from Android's native share sheet
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShareTarget(e.request));
    return;
  }

  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
        return resp;
      }).catch(() => cached);
    })
  );
});

async function handleShareTarget(request) {
  const formData = await request.formData();
  const payload = {
    title: formData.get('title') || '',
    text: formData.get('text') || '',
    url: formData.get('url') || ''
  };
  const files = formData.getAll('media').filter(f => f && f.size > 0);

  const cache = await caches.open('share-target-cache');
  if (files.length) {
    payload.fileCount = files.length;
    payload.fileMeta = files.map(f => ({ name: f.name, type: f.type }));
    await Promise.all(files.map((f, i) =>
      cache.put(`/__shared-file-${i}`, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }))
    ));
  }
  await cache.put('/__shared-payload', new Response(JSON.stringify(payload)));

  return Response.redirect('./share.html', 303);
}
