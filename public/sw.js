const CACHE_NAME = 'mapshare-companion-v4';
const SHARE_DATA_URL = '/share-target-data';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/vendor/use-l10n.js',
  '/l10n/en.json',
  '/l10n/es.json',
  '/l10n/br.json',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (event.request.method === 'GET' && url.pathname === SHARE_DATA_URL) {
    event.respondWith(popSharedData());
    return;
  }

  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html')))
  );
});

async function handleShareTarget(request) {
  const form = await request.formData();
  const data = {
    title: String(form.get('title') || ''),
    text: String(form.get('text') || ''),
    url: String(form.get('url') || ''),
    kmlName: '',
    kmlText: '',
  };

  const files = form.getAll('kml');
  const kmlFile = files.find((file) => file && typeof file.text === 'function');
  if (kmlFile) {
    data.kmlName = kmlFile.name || 'Shared KML';
    data.kmlText = await kmlFile.text();
  }

  const cache = await caches.open(CACHE_NAME);
  await cache.put(new URL(SHARE_DATA_URL, self.location.origin).href, new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  }));
  return Response.redirect(new URL('/?share-target=1', self.location.origin).href, 303);
}

async function popSharedData() {
  const cache = await caches.open(CACHE_NAME);
  const shareDataUrl = new URL(SHARE_DATA_URL, self.location.origin).href;
  const cached = await cache.match(shareDataUrl);
  await cache.delete(shareDataUrl);
  return cached || new Response('{}', {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
