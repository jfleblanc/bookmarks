// Service worker minimal : rend l'app installable (PWA). Aucune mise en cache : tout passe par le réseau.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
