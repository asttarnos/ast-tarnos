// AST Tarnos : l'expéditeur des notifications.
//
//  1. envoyerNotification : dès que le coach publie une notification (collection
//     « notifications »), elle part sur le téléphone des joueurs qui ont activé
//     les notifications. Si elle vise certains joueurs (champ « cibles » :
//     "4,12,17"), elle ne part que chez eux.
//  2. relancesAuto : chaque jour à midi (heure de Paris), si le coach a laissé
//     les relances allumées (reglages/relances.actif), l'appli relance
//       · ceux qui n'ont pas dit s'ils viennent à la séance du jour ou du lendemain ;
//       · la veille du match, les convoqués qui n'ont pas confirmé.
//     Une relance ne part qu'une fois par jour et par sujet.

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ region: 'europe-west1', maxInstances: 2 });

const LIEN_APPLI = 'https://asttarnos.github.io/ast-tarnos/JOUEUR.html';
const ICONE = 'https://asttarnos.github.io/ast-tarnos/icons/icon-192.png';

// ---------------------------------------------------------------- envoi
exports.envoyerNotification = onDocumentCreated('notifications/{id}', async (event) => {
  const d = event.data && event.data.data();
  if (!d) return;
  const titre = String(d.titre || 'AST Tarnos');
  const corps = String(d.corps || '');
  const cibles = String(d.cibles || '').split(',').map((s) => s.trim()).filter(Boolean);

  const snap = await db.collection('fcm_tokens').get();
  const lignes = [];
  snap.forEach((doc) => {
    const t = doc.data() || {};
    const num = String(t.num != null ? t.num : doc.id);
    if (!t.token) return;
    if (cibles.length && cibles.indexOf(num) < 0) return;
    lignes.push({ id: doc.id, token: t.token });
  });
  if (!lignes.length) return;

  for (let i = 0; i < lignes.length; i += 400) {
    const lot = lignes.slice(i, i + 400);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: lot.map((l) => l.token),
      notification: { title: titre, body: corps },
      webpush: {
        notification: { icon: ICONE, badge: ICONE },
        fcmOptions: { link: LIEN_APPLI }
      }
    });
    // les jetons morts (appli désinstallée, notifications coupées) sont retirés
    const morts = [];
    res.responses.forEach((r, k) => {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        morts.push(db.collection('fcm_tokens').doc(lot[k].id).delete());
      }
    });
    await Promise.all(morts);
  }
});

// ---------------------------------------------------------------- outils dates
const MOIS = { janvier: 0, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, aout: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11 };
function sansAccent(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function parserDate(txt) {
  const t = sansAccent(txt);
  let m = /(\d{1,2})\s+([a-z]+)\s+(\d{4})/.exec(t);
  if (m && MOIS[m[2]] != null) return { y: +m[3], m: MOIS[m[2]], d: +m[1] };
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return { y: +m[3], m: +m[2] - 1, d: +m[1] };
  return null;
}
function aujourdhuiParis() {
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
}
function semaineISO(dUTC) {
  const d = new Date(dUTC.getTime());
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const an = d.getUTCFullYear();
  const j1 = new Date(Date.UTC(an, 0, 4));
  j1.setUTCDate(j1.getUTCDate() + 3 - ((j1.getUTCDay() + 6) % 7));
  const n = 1 + Math.round((d - j1) / 604800000);
  return an + '-S' + (n < 10 ? '0' + n : n);
}
function memeJour(a, b) { return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate(); }
function normNom(s) { return sansAccent(s).replace(/[^a-z0-9]/g, ''); }
// même règle que l'appli joueur : « Bacque » retrouve « Bacque Théo »
function mots(t) { return sansAccent(String(t || '').replace(/\s*\(.*\)\s*$/, '')).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((m) => m.length > 1); }
function memeJoueur(a, b) {
  const ma = mots(a), mb = mots(b);
  if (!ma.length || !mb.length) return false;
  if (ma.join(' ') === mb.join(' ')) return true;
  const court = ma.length <= mb.length ? ma : mb, long = ma.length <= mb.length ? mb : ma;
  return court.every((m) => long.indexOf(m) !== -1);
}
function dansListe(liste, nom) { return (liste || []).some((n) => memeJoueur(n, nom)); }
const JOURS = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };
function jourSeance(sc) {
  const t = sansAccent(sc.lab || '');
  for (const j in JOURS) if (t.indexOf(j) >= 0) return JOURS[j];
  return ({ ma: 2, je: 4 })[sc.k];
}

// ---------------------------------------------------------------- relances
async function dejaFait(cle) {
  const ref = db.collection('relances').doc(cle);
  const s = await ref.get();
  if (s.exists) return true;
  await ref.set({ quand: new Date().toISOString() });
  return false;
}
async function publier(titre, corps, nums) {
  if (!nums.length) return;
  await db.collection('notifications').add({
    titre, corps, cibles: nums.join(','), dateEnvoi: new Date().toISOString(), auto: true
  });
}

exports.relancesAuto = onSchedule({ schedule: 'every day 12:00', timeZone: 'Europe/Paris' }, async () => {
  const reg = await db.collection('reglages').doc('relances').get();
  if (!reg.exists || reg.data().actif !== true) return;

  const main = await db.collection('saison').doc('main').get();
  if (!main.exists) return;
  let S = {};
  try { S = JSON.parse(main.data().data || '{}'); } catch (e) { return; }
  const joueurs = (S.JOUEURS || []).filter((j) => j && j.num != null);
  const auj = aujourdhuiParis();
  const demain = new Date(auj.getTime() + 86400000);
  const sem = semaineISO(auj);

  // --- 1. les séances : aujourd'hui (mardi/jeudi) ou demain
  const seances = (Array.isArray(S.CONVOC_SEANCES) && S.CONVOC_SEANCES.length) ? S.CONVOC_SEANCES
    : [{ k: 'ma', lab: 'Mardi', h: '19h30' }, { k: 'je', lab: 'Jeudi', h: '19h30' }];
  for (const sc of seances) {
    const dow = jourSeance(sc); if (dow == null) continue;
    let quand = null;
    if (auj.getUTCDay() === dow) quand = 'ce soir';
    else if (demain.getUTCDay() === dow && semaineISO(demain) === sem) quand = 'demain';
    if (!quand) continue;
    if (await dejaFait('seance_' + sem + '_' + sc.k + '_' + quand)) continue;
    const rep = await db.collection('disponibilites').where('semaine', '==', sem).where('seanceCle', '==', sc.k).get();
    const ont = new Set(); rep.forEach((d) => { const x = d.data(); if (x.joueurNum != null) ont.add(String(x.joueurNum)); });
    // si le coach a posé une liste pour cette séance, on ne relance que ceux de la liste
    const liste = ((S.CONVOS || {}).seances || {})[sc.k] || [];
    const vises = joueurs.filter((j) => !ont.has(String(j.num)) && (!liste.length || dansListe(liste, j.nom))).map((j) => String(j.num));
    await publier('Tu viens ' + quand + ' ?',
      'Séance ' + (sc.lab || '') + (sc.h ? ' · ' + sc.h : '') + ' : dis au coach si tu seras là, en un geste dans ton appli.', vises);
  }

  // --- 2. la veille du match : les convoqués qui n'ont pas confirmé
  const C = S.CONVOS || {};
  const listes = [].concat(C.a || [], C.b || [], C.u18 || []);
  if (!C.masque && listes.length && C.date) {
    const dm = parserDate(C.date);
    if (dm && memeJour(new Date(Date.UTC(dm.y, dm.m, dm.d)), demain)) {
      const cle = (C.date || '') + '|' + (C.adv || '');
      if (!(await dejaFait('convoc_' + normNom(cle)))) {
        const conf = await db.collection('confirmations_convocation').where('matchKey', '==', cle).get();
        const ont = new Set(); conf.forEach((d) => { const x = d.data(); if (x.joueurNum != null) ont.add(String(x.joueurNum)); });
        const vises = joueurs.filter((j) => dansListe(listes, j.nom) && !ont.has(String(j.num))).map((j) => String(j.num));
        await publier('Tu es convoqué demain', 'vs ' + (C.adv || '') + ' : confirme au coach dans ton appli.', vises);
      }
    }
  }
});

// ---------------------------------------------------------------- les proches
// La page publique du match (public/match) change à chaque saisie du bord de
// touche : on compare avant / après et on prévient les abonnés (collection
// « proches ») au coup d'envoi, à chaque but, à la mi-temps et au coup de sifflet final.
const LIEN_MATCH = 'https://asttarnos.github.io/ast-tarnos/MATCH.html';
function lireMatch(snap) {
  if (!snap || !snap.exists) return null;
  try { return JSON.parse((snap.data() || {}).data || 'null'); } catch (e) { return null; }
}
function evenements(a, b) {
  // a = avant, b = après ; renvoie la liste des alertes à envoyer
  const out = [];
  if (!b || !b.s) return out;
  const adv = b.s.adv || 'l’adversaire';
  const La = (a && a.live) || null, Lb = b.live || null;
  const meme = a && a.s && a.s.adv === b.s.adv;
  const sc = (L) => 'AST ' + (L.nous || 0) + ' – ' + (L.eux || 0) + ' ' + adv;
  if (Lb) {
    const avantJeu = !La || !meme || (!La.actif && !(La.base > 0));
    const debutRecent = (Lb.base || 0) < 300 && (Date.now() - (Lb.debut || Date.now())) < 10 * 60000;
    if (Lb.actif && avantJeu && debutRecent && !Lb.mt) out.push({ t: 'C’est parti !', c: 'Coup d’envoi : AST Tarnos – ' + adv + '. Le direct est ouvert.' });
    if (La && meme) {
      if ((Lb.nous || 0) > (La.nous || 0)) {
        const but = (Lb.buts || [])[(Lb.buts || []).length - 1];
        out.push({ t: 'BUT pour l’AST !', c: sc(Lb) + (but && but.n ? ' · ' + but.n + (but.m != null ? ' ' + but.m + '’' : '') : '') });
      }
      if ((Lb.eux || 0) > (La.eux || 0)) out.push({ t: 'But de ' + adv, c: sc(Lb) });
      if (Lb.mt && !Lb.actif && !(La.mt && !La.actif)) out.push({ t: 'Mi-temps', c: sc(Lb) });
      if (Lb.mt && Lb.actif && La.mt && !La.actif) out.push({ t: 'C’est reparti', c: 'Deuxième mi-temps · ' + sc(Lb) });
    }
  }
  if (b.fin && !(a && a.fin && meme)) {
    const L = Lb || {};
    const r = (L.nous || 0) > (L.eux || 0) ? 'Victoire !' : ((L.nous || 0) < (L.eux || 0) ? 'Défaite' : 'Match nul');
    out.push({ t: 'Terminé · ' + r, c: sc(L) });
  }
  return out;
}
exports.alerterProches = onDocumentWritten('public/{doc}', async (event) => {
  if (event.params.doc !== 'match') return;
  const a = lireMatch(event.data && event.data.before), b = lireMatch(event.data && event.data.after);
  const E = evenements(a, b);
  if (!E.length) return;
  const snap = await db.collection('proches').get();
  const L = []; const vus = new Set();
  snap.forEach((d) => { const t = (d.data() || {}).token; if (t && !vus.has(t)) { vus.add(t); L.push({ id: d.id, token: t }); } });
  if (!L.length) return;
  for (const e of E) {
    for (let i = 0; i < L.length; i += 400) {
      const lot = L.slice(i, i + 400);
      const res = await admin.messaging().sendEachForMulticast({
        tokens: lot.map((l) => l.token),
        notification: { title: e.t, body: e.c },
        webpush: { notification: { icon: ICONE, badge: ICONE, tag: 'ast-match' , renotify: true }, fcmOptions: { link: LIEN_MATCH } }
      });
      const morts = [];
      res.responses.forEach((r, k) => {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') morts.push(db.collection('proches').doc(lot[k].id).delete());
      });
      await Promise.all(morts);
    }
  }
});
