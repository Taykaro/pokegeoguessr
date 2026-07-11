// Construit la table { mapID_intérieur -> porte overworld (gx, gy en coords RAM) }.
//
// Principe : chaque intérieur (header H) se rejoint par un warp dont destMap==H,
// posé sur une carte source. Si la source est l'overworld, la position du warp
// est déjà en coords MATRICE -> on convertit en coords RAM (comme la position
// joueur et les cibles extérieures) par gy_RAM = gy_matrice + 28, gx inchangé
// (calibration session 4/5 : « matrice = RAM − (0,28) »).
// Pour les bâtiments à étages (le 2F se rejoint depuis le 1F, un autre
// intérieur), on remonte le graphe des warps jusqu'à trouver une carte overworld.
//
// Entrées : gamepacks/hgss/headers_dump.bin (541×24, eventsBank u16 @ +16),
//           warps.json (indexé par fichier event, régénéré via extract-warps.js).
// Sortie  : gamepacks/hgss/interior_doors.json  { "185": {gx,gy,src}, ... }
const fs = require('fs');
const path = require('path');

const HGSS = path.join(__dirname, '..', 'gamepacks', 'hgss');
const SCRATCH = process.argv[2];
if (!SCRATCH) { console.error('usage: node build-interior-doors.js <dossier_scratch_avec_warps.json>'); process.exit(1); }

const hdr = fs.readFileSync(path.join(HGSS, 'headers_dump.bin'));
const names = JSON.parse(fs.readFileSync(path.join(HGSS, 'map_names.json'), 'utf8'));
const warps = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'warps.json'), 'utf8'));
const HN = Math.floor(hdr.length / 24);
const Y_MATRIX_TO_RAM = 28;

// header -> fichier event (eventsBank)
const eventsBank = (h) => hdr.readUInt16LE(h * 24 + 16);
// fichier event -> header(s) qui l'utilisent
const bankToHeaders = new Map();
for (let h = 0; h < HN; h++) {
  const b = eventsBank(h);
  if (b === 0) continue;
  if (!bankToHeaders.has(b)) bankToHeaders.set(b, []);
  bankToHeaders.get(b).push(h);
}

// Une position de warp est-elle en coords overworld (matrice globale) plutôt
// que locale à un intérieur ? Les extérieurs vont de gx ~64-1438, gy ~32-508.
function looksOverworld(px, py) {
  return px >= 40 && px <= 1470 && py >= 4 && py <= 540 && (px > 60 || py > 60);
}

// Index : pour chaque destMap, la liste des warps entrants { bank, px, py }.
const inbound = new Map(); // destMap -> [{bank, px, py}]
for (let bank = 0; bank < warps.length; bank++) {
  const f = warps[bank];
  if (!f || !f.warps) continue;
  for (const w of f.warps) {
    if (!inbound.has(w.destMap)) inbound.set(w.destMap, []);
    inbound.get(w.destMap).push({ bank, px: w.px, py: w.py });
  }
}

// Remonte le graphe pour trouver la porte overworld menant à l'intérieur H.
function resolveDoor(H, visited = new Set()) {
  if (visited.has(H)) return null;
  visited.add(H);
  const ins = inbound.get(H);
  if (!ins) return null;
  // 1) une entrée directe depuis l'overworld ?
  for (const w of ins) {
    if (looksOverworld(w.px, w.py)) {
      return { gx: w.px, gy: w.py + Y_MATRIX_TO_RAM, src: 'direct' };
    }
  }
  // 2) sinon on remonte : la source du warp est un autre intérieur, on cherche
  //    SA porte overworld (ex. 2F -> 1F -> rue).
  for (const w of ins) {
    for (const srcHeader of (bankToHeaders.get(w.bank) || [])) {
      if (srcHeader === H) continue;
      const d = resolveDoor(srcHeader, visited);
      if (d) return { gx: d.gx, gy: d.gy, src: 'via-' + srcHeader };
    }
  }
  return null;
}

// On résout pour tous les mapID intérieurs présents dans le pack.
const pack = JSON.parse(fs.readFileSync(path.join(HGSS, '..', 'hgss_photos', 'pack.json'), 'utf8'));
const interiorIds = [...new Set((pack.photos || []).filter(p => p.interior).map(p => p.mapID))];

const doors = {};
let ok = 0, fail = 0;
const failures = [];
for (const id of interiorIds) {
  const d = resolveDoor(id);
  if (d) { doors[id] = { gx: d.gx, gy: d.gy }; ok++; }
  else { fail++; failures.push(`${id} (${names[id] || '?'})`); }
}

const outPath = path.join(HGSS, 'interior_doors.json');
fs.writeFileSync(outPath, JSON.stringify(doors));
console.log(`intérieurs: ${interiorIds.length} | portes résolues: ${ok} | échecs: ${fail}`);
if (failures.length) console.log('échecs:', failures.slice(0, 40).join(', ') + (failures.length > 40 ? ` … (+${failures.length - 40})` : ''));
console.log(`écrit: ${outPath}`);

// --- validations ponctuelles ---
console.log('\n=== validations ===');
for (const [id, expectZone] of [[185, 'Doublonville CP'], [137, 'Doublonville'], [6, 'Bellchime/Ecruteak']]) {
  const d = doors[id];
  console.log(`mapID ${id} (${names[id] || '?'}) -> ${d ? `porte (${d.gx}, ${d.gy})` : 'NON RÉSOLU'}  [${expectZone}]`);
}
