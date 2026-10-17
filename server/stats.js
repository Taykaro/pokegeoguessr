// Suivi de l'activité du site + records par photo.
// Persistance best-effort dans data/stats.json (survit aux redémarrages du
// process ; sur le NAS, data/ est un volume Docker conservé entre déploiements
// et sauvegardé chaque nuit).
// - Privé (tableau de bord /admin.html, protégé par STATS_KEY) : visites, joueurs,
//   pics de fréquentation, chiffres par jour, lieux les plus durs…
// - Public (/api/records, page /records.html) : records de vitesse par photo,
//   lieux les plus joués, quelques totaux.
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'stats.json');
const KEEP_DAYS = 90; // historique par jour conservé

let S = {
  startedAt: Date.now(), games: 0, rounds: 0, joins: 0, roomsCreated: 0, zones: {}, files: {},
  visits: 0, finds: 0, peak: { n: 0, at: null }, records: {}, photos: {}, days: {},
};
try { Object.assign(S, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch {}

let dirty = false;
function save() {
  if (!dirty) return; dirty = false;
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(S)); } catch {}
}
setInterval(save, 30000).unref();

// Jour local (TZ du conteneur) au format AAAA-MM-JJ
const dayKey = (t = new Date()) => t.toLocaleDateString('sv-SE');
function today() {
  const k = dayKey();
  if (!S.days[k]) {
    S.days[k] = { visits: 0, joins: 0, players: [], rooms: 0, games: 0, rounds: 0, finds: 0, peak: 0 };
    // purge : on ne garde que KEEP_DAYS jours
    const keys = Object.keys(S.days).sort();
    while (keys.length > KEEP_DAYS) delete S.days[keys.shift()];
  }
  return S.days[k];
}
const photoOf = (t) => {
  const f = t && t.file; if (!f) return null;
  if (!S.photos[f]) S.photos[f] = { zone: (t && t.zone) || '?', interior: !!(t && t.interior), plays: 0, found: 0, sumMs: 0 };
  return S.photos[f];
};

// Une page de jeu ouverte (socket connecté) ; `online` = visiteurs connectés en ce moment
function recordVisit(online) {
  S.visits++; const d = today(); d.visits++;
  if (online > S.peak.n) S.peak = { n: online, at: new Date().toISOString() };
  if (online > d.peak) d.peak = online;
  dirty = true;
}
// Un joueur entre dans un salon (solo ou multi)
function recordJoin(name) {
  S.joins++; const d = today(); d.joins++;
  const n = String(name || '').trim().toLowerCase();
  if (n && !d.players.includes(n)) d.players.push(n);
  dirty = true;
}
function recordRoom() { S.roomsCreated++; today().rooms++; dirty = true; }
function recordGame() { S.games++; today().games++; dirty = true; save(); }
function recordRound(t) {
  S.rounds++; today().rounds++;
  const z = (t && t.zone) || (t && t.interior ? `intérieur ${t.mapID}` : '?');
  S.zones[z] = (S.zones[z] || 0) + 1;
  if (t && t.file) S.files[t.file] = (S.files[t.file] || 0) + 1;
  const p = photoOf(t); if (p) p.plays++;
  dirty = true;
}
// Un joueur trouve le lieu en `ms` depuis le début de la manche. Renvoie
// { newRecord } (record de vitesse de cette photo battu).
function recordFind(t, name, ms, first) {
  S.finds++; today().finds++;
  const p = photoOf(t);
  if (p && first) { p.found++; p.sumMs += ms; }
  let newRecord = false;
  if (t && t.file) {
    const r = S.records[t.file];
    if (!r || ms < r.ms) {
      S.records[t.file] = { ms, by: String(name), at: new Date().toISOString(), zone: (t && t.zone) || '?' };
      newRecord = true;
    }
  }
  dirty = true;
  return { newRecord };
}
const recordFor = (t) => (t && t.file && S.records[t.file]) || null;

// Public : records de vitesse + lieux populaires (pas de chiffres de fréquentation)
function publicRecords() {
  const fastest = Object.entries(S.records).sort((a, b) => a[1].ms - b[1].ms).slice(0, 20)
    .map(([file, r]) => ({ zone: r.zone, by: r.by, ms: r.ms, at: r.at }));
  const popular = Object.entries(S.zones).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([zone, n]) => ({ zone, n }));
  const latest = Object.values(S.records).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10)
    .map((r) => ({ zone: r.zone, by: r.by, ms: r.ms, at: r.at }));
  return { rounds: S.rounds, finds: S.finds, games: S.games, recordsCount: Object.keys(S.records).length, fastest, latest, popular };
}

// Privé : tout, + l'état en direct fourni par le serveur
function snapshot(live) {
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));
  const days = Object.entries(S.days).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 30)
    .map(([day, d]) => ({ day, visits: d.visits, joins: d.joins, players: d.players.length, rooms: d.rooms, games: d.games, rounds: d.rounds, finds: d.finds, peak: d.peak }));
  const photos = Object.entries(S.photos).map(([file, p]) => ({
    file, zone: p.zone, interior: p.interior, plays: p.plays, found: p.found,
    rate: p.plays ? p.found / p.plays : 0, avgSec: p.found ? Math.round(p.sumMs / p.found / 1000) : null,
  }));
  return {
    since: new Date(S.startedAt).toISOString(), live,
    totals: { visits: S.visits, joins: S.joins, roomsCreated: S.roomsCreated, games: S.games, rounds: S.rounds, finds: S.finds, records: Object.keys(S.records).length },
    peak: S.peak, days,
    hardest: photos.filter((p) => p.plays >= 3).sort((a, b) => a.rate - b.rate || b.plays - a.plays).slice(0, 15),
    easiest: photos.filter((p) => p.found >= 2).sort((a, b) => a.avgSec - b.avgSec).slice(0, 10),
    topZones: top(S.zones, 25),
    records: publicRecords().fastest,
  };
}

module.exports = { recordVisit, recordRound, recordGame, recordJoin, recordRoom, recordFind, recordFor, publicRecords, snapshot };
