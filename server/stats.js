// Suivi léger de l'activité : parties, manches, lieux joués, connexions.
// Persistance best-effort dans data/stats.json (survit aux redémarrages du
// process ; ⚠️ remis à zéro à chaque REDÉPLOIEMENT sur Render car le disque y
// est éphémère — pour du durable au long cours, brancher une analytics externe).
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'stats.json');

let S = { startedAt: Date.now(), games: 0, rounds: 0, joins: 0, roomsCreated: 0, zones: {}, files: {} };
try { Object.assign(S, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch {}

let dirty = false;
function save() {
  if (!dirty) return; dirty = false;
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(S)); } catch {}
}
setInterval(save, 30000).unref && setInterval(save, 30000).unref();

function recordRound(t) {
  S.rounds++;
  const z = (t && t.zone) || (t && t.interior ? `intérieur ${t.mapID}` : '?');
  S.zones[z] = (S.zones[z] || 0) + 1;
  if (t && t.file) S.files[t.file] = (S.files[t.file] || 0) + 1;
  dirty = true;
}
function recordGame() { S.games++; dirty = true; save(); }
function recordJoin() { S.joins++; dirty = true; }
function recordRoom() { S.roomsCreated++; dirty = true; }

function snapshot() {
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));
  return {
    since: new Date(S.startedAt).toISOString(),
    games: S.games, rounds: S.rounds, joins: S.joins, roomsCreated: S.roomsCreated,
    topZones: top(S.zones, 25), topFiles: top(S.files, 25),
  };
}

module.exports = { recordRound, recordGame, recordJoin, recordRoom, snapshot };
