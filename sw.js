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
  // Un message avec « notification » est déjà affiché par Firebase lui-même :
  // l'afficher ici aussi le doublait. On n'affiche que les messages « data ».
  messaging.onBackgroundMessage(function(payload){
    if(payload && payload.notification) return;
    var d=(payload&&payload.data)||{};
    self.registration.showNotification(d.titre||'AST Tarnos',{
      body:d.corps||'', icon:'./icons/icon-192.png', badge:'./icons/icon-192.png',
      tag:d.tag||undefined, data:{lien:d.lien||'./JOUEUR.html'}
    });
  });
}catch(e){ /* config pas encore complétée, on ignore */ }

// Toucher une notification ouvre la bonne page (l'appli ou la page du match)
self.addEventListener('notificationclick', function(event){
  // seulement nos propres notifications : Firebase gère le clic sur les siennes
  var lien=event.notification.data && event.notification.data.lien;
  if(!lien) return;
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window', includeUncontrolled:true}).then(function(L){
    for(var i=0;i<L.length;i++){ if(L[i].url.indexOf(lien.replace('./',''))>=0 && 'focus' in L[i]) return L[i].focus(); }
    return clients.openWindow(lien);
  }));
});

const CACHE_NAME = 'ast-tarnos-v187';
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
      // cache:'reload' : on ne reprend jamais une vieille copie du navigateur à l'installation
      return cache.addAll(URLS_TO_CACHE.map(function(u){ return new Request(u, {cache:'reload'}); })).catch(function() {
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
      // On repart de l'adresse seule : certains navigateurs refusent de recopier une requête de navigation
      fetch(new Request(event.request.url, { cache: 'no-store', credentials: 'same-origin' })).then(function(response) {
        if (response && response.status === 200) {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, responseClone); });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request, { ignoreSearch: true });
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
