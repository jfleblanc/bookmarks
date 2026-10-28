// Service worker de bookmarks : garde l'application et les vignettes sur l'appareil pour l'utilisation hors ligne.
// Les données (signets, tags, collections) sont copiées par l'app dans IndexedDB ; ici on ne s'occupe que des fichiers.
const SHELL = 'bm-shell-v2';
const THUMBS = 'bm-thumbs';   // rempli par l'app selon le choix « Captures réelles »
const FONTS = 'bm-fonts';
const STATIC = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/icon.svg'];

async function cacheShell() {
  const cache = await caches.open(SHELL);
  const res = await fetch('/', { cache: 'no-store' });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put('/', res);
  const assets = [...new Set(html.match(/\/assets\/[^"'\s)]+/g) || [])];
  await Promise.all([...STATIC.slice(1), ...assets].map(u => cache.add(u).catch(() => {})));
  // retire les anciens fichiers de build
  const keep = new Set(assets.map(a => new URL(a, self.location.origin).href));
  for (const req of await cache.keys()) {
    if (new URL(req.url).pathname.startsWith('/assets/') && !keep.has(req.url)) await cache.delete(req);
  }
}

self.addEventListener('install', event => {
  event.waitUntil(cacheShell().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('bm-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && name !== THUMBS) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Navigation : réseau d'abord (version fraîche), sinon l'app gardée sur l'appareil
    if (req.mode === 'navigate') {
      if (url.pathname.startsWith('/api/')) return;
      event.respondWith((async () => {
        try {
          const res = await fetch(req);
          if (res.ok && url.pathname === '/') {
            const copy = res.clone();
            caches.open(SHELL).then(c => c.put('/', copy));
          }
          return res;
        } catch {
          return (await caches.match('/', { cacheName: SHELL })) || Response.error();
        }
      })());
      return;
    }
    // Fichiers de build : leur nom change à chaque version, on peut les garder tels quels
    if (url.pathname.startsWith('/assets/') || STATIC.includes(url.pathname)) {
      event.respondWith(cacheFirst(req, SHELL));
      return;
    }
    // Vignettes : servies depuis l'appareil si elles y sont (mode « Captures réelles »)
    if (url.pathname.startsWith('/api/thumbs/')) {
      event.respondWith((async () => {
        const hit = await caches.match(req, { cacheName: THUMBS });
        return hit || fetch(req);
      })());
      return;
    }
    return; // le reste de l'API passe directement par le réseau
  }

  // Polices Google : copie locale, rafraîchie en arrière-plan
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
  }
});

// L'app demande la mise à jour du cache de l'application après un déploiement
self.addEventListener('message', event => {
  if (event.data === 'refresh-shell') event.waitUntil(cacheShell().catch(() => {}));
});
