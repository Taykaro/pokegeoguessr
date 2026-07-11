// Extrait le masque de praticabilité de l'overworld HGSS, indexé en
// COORDONNÉES JEU (celles lues en RAM), pour que le serveur puisse tirer des
// cibles et vérifier les victoires directement.
//
// Formats : décomp pret/pokeheartgold (map_matrix) + DSPRE (MapFile.cs).
//   matrice monde : NARC a/0/4/1 fichier 0 (47x17 chunks de 32x32 tuiles)
//   collisions    : NARC a/0/6/5, un land_data par chunk
//     [4 u32 tailles] [BGS: sig 0x1234 + u16 len] [2048o = 32*32 paires type,collision]
//     collision 0x00 = praticable.
//
// Mapping coord-jeu -> matrice (RE-CALIBRÉ 2026-07-07, voir HANDOFF §3) :
//   matrice = RAM - (0, 28), tuile locale ROW-MAJOR idx = ly*32 + lx.
// Preuves : le warp du CP de Doublonville (fichier events 73, coords MATRICE
// (352,368)) correspond au tapis validé en RAM (352,396) -> offset (0,28),
// chunk header GOLDENROD, tuile type porte 0x69 ; alignement 5/5 des warps de
// Bourgeon sur les tuiles porte du land 0 (chunk 21,12) ; superposition
// visuelle walkmask/map.png correcte sur les deux villes. L'ancien mapping
// (-54,-30 + indexation transposée) s'était verrouillé sur la copie BÊTA de
// Doublonville présente dans la matrice.
// Collision : bit 7 = bloqué. Les valeurs basses (0x00/0x02/0x04/0x06...)
// sont praticables (vérifié : le joueur se tient sur des tuiles coll 0x06).
//
// Usage: node tools/extract-walkability.js "<ROM .nds>"
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const DX = 0, DY = -28;            // décalage coord-jeu (RAM) -> matrice
const localIdx = (lx, ly) => ly * 32 + lx; // row-major

const romPath = process.argv[2];
if (!romPath) { console.error('Usage: node tools/extract-walkability.js "<ROM .nds>"'); process.exit(1); }
const rom = fs.readFileSync(romPath);

const fntOff = rom.readUInt32LE(0x40);
const fatOff = rom.readUInt32LE(0x48);
function readDir(dirId) {
  const entryOff = fntOff + (dirId & 0xfff) * 8;
  let sub = fntOff + rom.readUInt32LE(entryOff);
  let fileId = rom.readUInt16LE(entryOff + 4);
  const entries = [];
  for (;;) {
    const typeLen = rom[sub++];
    if (typeLen === 0) break;
    const isDir = (typeLen & 0x80) !== 0;
    const len = typeLen & 0x7f;
    const name = rom.toString('ascii', sub, sub + len);
    sub += len;
    if (isDir) { entries.push({ name, dirId: rom.readUInt16LE(sub) }); sub += 2; }
    else entries.push({ name, fileId: fileId++ });
  }
  return entries;
}
function findFile(parts) {
  let dirId = 0xf000;
  for (let i = 0; i < parts.length; i++) {
    const e = readDir(dirId).find((x) => x.name === parts[i]);
    if (!e) throw new Error('introuvable: ' + parts.join('/'));
    if (i === parts.length - 1) {
      const s = rom.readUInt32LE(fatOff + e.fileId * 8);
      return rom.subarray(s, rom.readUInt32LE(fatOff + e.fileId * 8 + 4));
    }
    dirId = e.dirId;
  }
}
function narcFiles(buf) {
  let off = 0x10;
  const btafSize = buf.readUInt32LE(off + 4);
  const count = buf.readUInt32LE(off + 8);
  const fat = [];
  for (let i = 0; i < count; i++) fat.push([buf.readUInt32LE(off + 12 + i * 8), buf.readUInt32LE(off + 16 + i * 8)]);
  off += btafSize;
  off += buf.readUInt32LE(off + 4);
  const dataStart = off + 8;
  return fat.map(([s, e]) => buf.subarray(dataStart + s, dataStart + e));
}

const m = narcFiles(findFile(['a', '0', '4', '1']))[0];
const W = m[0], H = m[1];
let p = 5 + m[4] + W * H * 2 + W * H;
const lands = [];
for (let i = 0; i < W * H; i++) lands.push(m.readUInt16LE(p + i * 2));
console.log(`Matrice monde : ${W}x${H} chunks`);

const lnarc = narcFiles(findFile(['a', '0', '6', '5']));
const permsCache = new Map();
function permsOf(landId) {
  if (!permsCache.has(landId)) {
    const lf = lnarc[landId];
    let off = 16;
    if (lf.readUInt16LE(off) === 0x1234) off += 4 + lf.readUInt16LE(off + 2);
    permsCache.set(landId, lf.subarray(off, off + 2048));
  }
  return permsCache.get(landId);
}

// Octets de type de tuile (comportement) valant "eau navigable" (Surf),
// extraits de metatile_behavior.c (pret/pokeheartgold, table _020FCA74,
// bit0 = IsSurfableWater). Sans Surf le perso ne peut PAS marcher dessus.
const SURF_TYPES = new Set([16, 17, 18, 19, 20, 21, 25, 42, 80, 81, 82, 83, 115, 120, 124]);

// Praticabilité à la coordonnée JEU.
// 0 = mur/vide, 1 = praticable à pied, 2 = praticable en Surf (eau).
function walkableAt(gx, gy) {
  const mx = gx + DX, my = gy + DY;
  if (mx < 0 || my < 0) return 0;
  const cx = mx >> 5, cy = my >> 5;
  if (cx >= W || cy >= H) return 0;
  const land = lands[cy * W + cx];
  if (land === 0xffff || land >= lnarc.length) return 0;
  const perms = permsOf(land);
  const idx = localIdx(mx & 31, my & 31) * 2;
  if ((perms[idx + 1] & 0x80) !== 0) return 0;
  return SURF_TYPES.has(perms[idx]) ? 2 : 1;
}

// Masque en coord-jeu : blanc = praticable à pied, bleu = praticable en Surf
// (eau), noir = bloqué/hors-carte. Le canal rouge seul (valeur pure) permet un
// filtrage simple : rouge=255 ET bleu=0 => à pied uniquement.
const GW = W * 32 - DX;
const GH = H * 32 - DY;
const png = new PNG({ width: GW, height: GH });
let nWalk = 0, nSurf = 0;
for (let gy = 0; gy < GH; gy++) {
  for (let gx = 0; gx < GW; gx++) {
    const w = walkableAt(gx, gy);
    const o = (gy * GW + gx) * 4;
    if (w === 1) { png.data[o] = 255; png.data[o + 1] = 255; png.data[o + 2] = 255; nWalk++; }
    else if (w === 2) { png.data[o] = 0; png.data[o + 1] = 0; png.data[o + 2] = 255; nSurf++; }
    else { png.data[o] = 0; png.data[o + 1] = 0; png.data[o + 2] = 0; }
    png.data[o + 3] = 255;
  }
}
const out = path.join(__dirname, '..', 'gamepacks', 'hgss', 'walkmask.png');
fs.writeFileSync(out, PNG.sync.write(png));
console.log(`Masque praticabilité (coord-jeu, ${GW}x${GH}) : ${out}`);
console.log(`Tuiles à pied (blanc) : ${nWalk}`);
console.log(`Tuiles Surf (bleu)    : ${nSurf}`);
