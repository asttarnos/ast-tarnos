const CACHE_NAME = 'ast-tarnos-v4';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './coach.html',
  './joueur.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(URLS_TO_CACHE).catch(function() {
        // Si un des fichiers n'existe pas (ex: coach.html absent côté joueurs), on continue quand même
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  // Les données Firestore (convocations, planning, stats...) ne doivent jamais
  // venir du cache : elles doivent toujours être fraîches, pour le coach comme pour les joueurs.
  if (event.request.url.indexOf('firestore.googleapis.com') !== -1) {
    return;
  }
  // Les pages HTML (coach.html, joueur.html...) : réseau en priorité pour voir
  // les mises à jour immédiatement. Le cache ne sert que si le réseau est indisponible (hors-ligne).
  if (event.request.mode === 'navigate' || event.request.url.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, responseClone); });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }
  // Le reste (icônes, manifest...) : cache d'abord, mise à jour en arrière-plan.
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var networkFetch = fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(function() {
        return cached;
      });
      return cached || networkFetch;
    })
  );
});
