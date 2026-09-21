// ===== Notifications push (Firebase Cloud Messaging) =====
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
// ⚠️ Mêmes valeurs que dans JOUEUR.html (var FIREBASE_CONFIG) — à compléter depuis la console Firebase
firebase.initializeApp({
  apiKey:'AIzaSyC2Ip1OWL505ZfXIuvt7UHHy3t7wr6Vq1U',
  authDomain:'notes-match-ast.firebaseapp.com',
  projectId:'notes-match-ast',
  storageBucket:'notes-match-ast.firebasestorage.app',
  messagingSenderId:'512648656255',
  appId:'1:512648656255:web:9243b8d6139e9ac82f564a'
});
try{
  var messaging=firebase.messaging();
  messaging.onBackgroundMessage(function(payload){
    var titre=(payload.notification&&payload.notification.title)||'AST Tarnos';
    var options={
      body:(payload.notification&&payload.notification.body)||'',
      icon:'./icons/icon-192.png',
      badge:'./icons/icon-192.png'
    };
    self.registration.showNotification(titre,options);
  });
}catch(e){ /* config pas encore complétée, on ignore */ }

const CACHE_NAME = 'ast-tarnos-v9';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './COACH.html',
  './JOUEUR.html',
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
  // Les pages HTML (COACH.html, JOUEUR.html...) : réseau en priorité pour voir
  // les mises à jour immédiatement. Le cache ne sert que si le réseau est indisponible (hors-ligne).
  if (event.request.mode === 'navigate' || event.request.url.endsWith('.html')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then(function(response) {
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
