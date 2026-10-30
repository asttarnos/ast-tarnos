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
      body:d.corps||'', icon:'./icon-192.png', badge:'./icon-192.png',
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

const CACHE_NAME = 'ast-tarnos-v252';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './COACH.html',
  './JOUEUR.html',
  './MATCH.html',
  './manifest.json',
  './plateau-coach-4222.html', './plateau-coach-4231.html', './plateau-coach-352.html', './plateau-coach-433.html',
  './plateau-joueur-4222.html', './plateau-joueur-4231.html', './plateau-joueur-352.html', './plateau-joueur-433.html',
  './terrain-1.webp', './terrain-2.webp',
  './terrain-p1.jpg', './terrain-p2.jpg', './terrain-p3.jpg', './terrain-p4.jpg', './terrain-p5.jpg', './terrain-p6.jpg', './terrain-p7.jpg'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // un fichier à la fois : s'il en manque un, les autres sont quand même gardés
      return Promise.all(URLS_TO_CACHE.map(function(u){
        return fetch(new Request(u, {cache:'reload'})).then(function(r){ if(r && r.status===200) return cache.put(u, r); }).catch(function(){});
      }));
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

// la « signature » d'une version : ce que le serveur dit de son fichier
function swSignature(r){ if(!r) return ''; var h=r.headers; return (h.get('etag')||'')+'|'+(h.get('last-modified')||'')+'|'+(h.get('content-length')||''); }
function swPrevenir(page){
  self.clients.matchAll({type:'window'}).then(function(L){ L.forEach(function(c){ c.postMessage({type:'maj-dispo', page:page}); }); });
}

self.addEventListener('fetch', function(event) {
  var url=event.request.url;
  // Les données Firestore (convocations, planning, stats...) ne doivent jamais
  // venir du cache : elles doivent toujours être fraîches, pour le coach comme pour les joueurs.
  if (url.indexOf('firestore.googleapis.com') !== -1) return;
  if (event.request.method !== 'GET') return;
  // Les pages (COACH, JOUEUR, MATCH…) : la version en mémoire s'ouvre tout de suite,
  // et on vérifie en même temps s'il y en a une nouvelle. Si oui, elle est rangée
  // pour la prochaine ouverture et la page affiche « Nouvelle version prête ».
  if (event.request.mode === 'navigate' || /\.html(\?|$)/.test(url)) {
    // Les pages : toujours la dernière version mise en ligne. Si le réseau ne répond pas
    // en 3 secondes (bord du terrain), on ouvre la copie gardée sur le téléphone.
    var cle=url.split('#')[0].split('?')[0];
    event.respondWith(caches.open(CACHE_NAME).then(function(cache){
      var reseau=fetch(new Request(cle, { cache: 'no-store', credentials: 'same-origin' })).then(function(response){
        if (response && response.status === 200) cache.put(cle, response.clone());
        return response;
      });
      var delai=new Promise(function(ok){ setTimeout(ok, 3000); }).then(function(){ return cache.match(cle); });
      return Promise.race([reseau.catch(function(){ return null; }), delai]).then(function(r){
        if (r) return r;
        return reseau.catch(function(){ return cache.match(cle, { ignoreSearch: true }); });
      }).then(function(r){ return r || reseau; });
    }));
    return;
  }
  // Le reste (plateaux, photos de terrain, icônes, manifest...) : cache d'abord, mise à jour en arrière-plan.
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var networkFetch = fetch(event.request).then(function(response) {
        if (response && response.status === 200 && url.indexOf(self.location.origin)===0) {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(function() {
        return cached;
      });
      if (cached) { event.waitUntil(networkFetch.catch(function(){})); return cached; }
      return networkFetch;
    })
  );
});
