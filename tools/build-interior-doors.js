// Construit la table { mapID_intérieur -> porte overworld (gx, gy en coords RAM) }
// pour l'indice chaud/froid, en couvrant TOUS les intérieurs du jeu (pas
// seulement ceux qui ont des photos dans le pack) : sinon un joueur qui entre
// dans une grotte non capturée (ex. Grotte Union, map 99) n'a aucune porte donc
// aucun chaud/froid.
//
// Principe (voir HANDOFF) : un intérieur H se rejoint par un warp dont
// destMap==H ; si la source est l'overworld, la position du warp est en coords
// MATRICE -> RAM = (px, py+28). Bâtiments à étages : on remonte le graphe des
// warps jusqu'à une carte overworld.
//
// On identifie les cartes OVERWORLD via la matrice monde (NARC a/0/4/1, section
// headers) pour NE PAS leur donner de porte (leurs coords sont déjà globales ;
// une porte casserait le chaud/froid extérieur).
//
// Usage: node tools/build-interior-doors.js <scratch_avec_warps.json> "<ROM.nds>"
const fs = require('fs');
const path = require('path');

const HGSS = path.join(__dirname, '..', 'gamepacks', 'hgss');
const SCRATCH = process.argv[2];
const ROM_PATH = process.argv[3];
if (!SCRATCH || !ROM_PATH) {
  console.error('usage: node build-interior-doors.js <scratch_avec_warps.json> "<ROM.nds>"');
  process.exit(1);
}

const hdr = fs.readFileSync(path.join(HGSS, 'headers_dump.bin'));
const names = JSON.parse(fs.readFileSync(path.join(HGSS, 'map_names.json'), 'utf8'));
const warps = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'warps.json'), 'utf8'));
const HN = Math.floor(hdr.length / 24);
const Y_MATRIX_TO_RAM = 28;

// --- ensemble des headers OVERWORLD depuis la matrice monde ---
const rom = fs.readFileSync(ROM_PATH);
const fntOff = rom.readUInt32LE(0x40), fatOff = rom.readUInt32LE(0x48);
function readDir(d) { const eo = fntOff + (d & 0xfff) * 8; let s = fntOff + rom.readUInt32LE(eo); let fid = rom.readUInt16LE(eo + 4); const es = []; for (;;) { const tl = rom[s++]; if (tl === 0) break; const iD = (tl & 0x80) !== 0; const l = tl & 0x7f; const n = rom.toString('ascii', s, s + l); s += l; if (iD) { es.push({ name: n, dirId: rom.readUInt16LE(s) }); s += 2; } else es.push({ name: n, fileId: fid++ }); } return es; }
function findFile(ps) { let d = 0xf000; for (let i = 0; i < ps.length; i++) { const e = readDir(d).find((x) => x.name === ps[i]); if (i === ps.length - 1) { const s = rom.readUInt32LE(fatOff + e.fileId * 8); return rom.subarray(s, rom.readUInt32LE(fatOff + e.fileId * 8 + 4)); } d = e.dirId; } }
function narc(b) { let o = 0x10; const bs = b.readUInt32LE(o + 4); const c = b.readUInt32LE(o + 8); const fat = []; for (let i = 0; i < c; i++) fat.push([b.readUInt32LE(o + 12 + i * 8), b.readUInt32LE(o + 16 + i * 8)]); o += bs; o += b.readUInt32LE(o + 4); const ds = o + 8; return fat.map(([s, e]) => b.subarray(ds + s, ds + e)); }
const matrix = narc(findFile(['a', '0', '4', '1']))[0];
const MW = matrix[0], MH = matrix[1];
const overworld = new Set();
{ const off = 5 + matrix[4]; for (let i = 0; i < MW * MH; i++) { const h = matrix.readUInt16LE(off + i * 2); if (h !== 0xffff) overworld.add(h); } }

const eventsBank = (h) => hdr.readUInt16LE(h * 24 + 16);
const bankToHeaders = new Map();
for (let h = 0; h < HN; h++) {
  const b = eventsBank(h);
  if (b === 0) continue;
  if (!bankToHeaders.has(b)) bankToHeaders.set(b, []);
  bankToHeaders.get(b).push(h);
}

function looksOverworld(px, py) {
  return px >= 40 && px <= 1470 && py >= 4 && py <= 540 && (px > 60 || py > 60);
}

const inbound = new Map(); // destMap -> [{bank, px, py}]
for (let bank = 0; bank < warps.length; bank++) {
  const f = warps[bank];
  if (!f || !f.warps) continue;
  for (const w of f.warps) {
    if (!inbound.has(w.destMap)) inbound.set(w.destMap, []);
    inbound.get(w.destMap).push({ bank, px: w.px, py: w.py });
  }
}

function resolveDoor(H, visited = new Set()) {
  if (visited.has(H)) return null;
  visited.add(H);
  const ins = inbound.get(H);
  if (!ins) return null;
  for (const w of ins) {
    if (looksOverworld(w.px, w.py)) return { gx: w.px, gy: w.py + Y_MATRIX_TO_RAM };
  }
  for (const w of ins) {
    for (const srcHeader of (bankToHeaders.get(w.bank) || [])) {
      if (srcHeader === H || overworld.has(srcHeader)) continue; // ne remonte que via des intérieurs
      const d = resolveDoor(srcHeader, visited);
      if (d) return d;
    }
  }
  return null;
}

// Tous les intérieurs = headers avec une banque d'events, hors overworld,
// et dont le nom n'est pas un placeholder.
const BAD = /^(EVERYWHERE|NOTHING|UNUSED|UNION$|WIFI|DIRECT|UNDERGROUND|MAX|POKemon|TEST)/i;
const interiorHeaders = [];
for (let h = 0; h < HN; h++) {
  if (overworld.has(h)) continue;
  if (eventsBank(h) === 0) continue;
  const nm = names[h] || '';
  if (!nm || BAD.test(nm)) continue;
  interiorHeaders.push(h);
}

const doors = {};
let ok = 0, fail = 0;
const failures = [];
for (const id of interiorHeaders) {
  const d = resolveDoor(id);
  if (d) { doors[id] = { gx: d.gx, gy: d.gy }; ok++; }
  else { fail++; failures.push(`${id} (${names[id] || '?'})`); }
}

const outPath = path.join(HGSS, 'interior_doors.json');
fs.writeFileSync(outPath, JSON.stringify(doors));
console.log(`overworld: ${overworld.size} headers | intérieurs testés: ${interiorHeaders.length}`);
console.log(`portes résolues: ${ok} | échecs: ${fail}`);
if (failures.length) console.log('échecs:', failures.slice(0, 50).join(', ') + (failures.length > 50 ? ` … (+${failures.length - 50})` : ''));
console.log(`écrit: ${outPath}`);

// validations
console.log('\n=== validations ===');
for (const [id, label] of [[99, 'Grotte Union 1F'], [185, 'CP Doublonville'], [123, 'Dark Cave R45'], [176, 'Dark Cave R31']]) {
  console.log(`mapID ${id} (${names[id] || '?'}) -> ${doors[id] ? `porte (${doors[id].gx}, ${doors[id].gy})` : 'NON RÉSOLU'}  [${label}]`);
}
