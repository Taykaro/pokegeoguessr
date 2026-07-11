// v2 : corrige l'erreur de la v1 (qui confondait index de fichier d'evenements
// et ID d'en-tete de carte -- la premiere etape (carte "1") menait au vide car
// destMap=1 = MAP_NOTHING, un header placeholder vide, pas une vraie carte).
//
// Ici on lit la VRAIE table d'en-tetes (541 entrees, 24 octets, champ
// "eventsBank" a l'octet 16 = index reel du fichier d'evenements) extraite en
// direct depuis la RAM (voir dump_headers.lua), on filtre les headers
// speciaux/inutilises par leur nom (pret/pokeheartgold maps.h), et on chaine
// UNIQUEMENT des headers reels vers de vrais fichiers d'evenements possedant
// au moins un warp.
//
// Usage: node tools/build-warp-tour-v2.js <rom_source.nds> <headers_dump.bin> <rom_sortie.nds> <order.json>
const fs = require('fs');
const path = require('path');

const [romPath, headersDumpPath, outPath, orderOutPath] = process.argv.slice(2);
if (!romPath || !headersDumpPath || !outPath) {
  console.error('Usage: node tools/build-warp-tour-v2.js <rom_source.nds> <headers_dump.bin> <rom_sortie.nds> <order.json>');
  process.exit(1);
}

const rom = fs.readFileSync(romPath);
const buf = Buffer.from(rom);
const hdrBuf = fs.readFileSync(headersDumpPath);
const HEADER_COUNT = 541;
function eventsBank(h) { return hdrBuf.readUInt16LE(h * 24 + 16); }

// -- noms des maps (pret/pokeheartgold include/constants/maps.h) --
const namesPath = path.join(__dirname, '..', 'gamepacks', 'hgss', 'map_names.json');
let names = {};
if (fs.existsSync(namesPath)) names = JSON.parse(fs.readFileSync(namesPath));

const fntOff = rom.readUInt32LE(0x40), fatOff = rom.readUInt32LE(0x48);
function readDir(d) {
  const eo = fntOff + (d & 0xfff) * 8;
  let s = fntOff + rom.readUInt32LE(eo);
  let fid = rom.readUInt16LE(eo + 4);
  const es = [];
  for (;;) {
    const tl = rom[s++];
    if (tl === 0) break;
    const isDir = (tl & 0x80) !== 0;
    const l = tl & 0x7f;
    const n = rom.toString('ascii', s, s + l);
    s += l;
    if (isDir) { es.push({ name: n, dirId: rom.readUInt16LE(s) }); s += 2; }
    else es.push({ name: n, fileId: fid++ });
  }
  return es;
}
function findFileId(ps) {
  let d = 0xf000;
  for (let i = 0; i < ps.length; i++) {
    const e = readDir(d).find((x) => x.name === ps[i]);
    if (i === ps.length - 1) return e.fileId;
    d = e.dirId;
  }
}
const eventsFileId = findFileId(['a', '0', '3', '2']);
const narcStart = rom.readUInt32LE(fatOff + eventsFileId * 8);
const narcEnd = rom.readUInt32LE(fatOff + eventsFileId * 8 + 4);

function parseNarcFat(narcBuf) {
  let o = 0x10;
  const btafSize = narcBuf.readUInt32LE(o + 4);
  const count = narcBuf.readUInt32LE(o + 8);
  const subFat = [];
  for (let i = 0; i < count; i++) subFat.push([narcBuf.readUInt32LE(o + 12 + i * 8), narcBuf.readUInt32LE(o + 16 + i * 8)]);
  o += btafSize;
  o += narcBuf.readUInt32LE(o + 4);
  const dataStart = o + 8;
  return { subFat, dataStart };
}
const narcBuf = rom.subarray(narcStart, narcEnd);
const { subFat, dataStart } = parseNarcFat(narcBuf);

function parseWarps(subBuf) {
  let pos = 0;
  try {
    const bgs = subBuf.readUInt32LE(pos); pos += 4 + bgs * 0x14;
    const obj = subBuf.readUInt32LE(pos); pos += 4 + obj * 0x20;
    const warpCount = subBuf.readUInt32LE(pos); pos += 4;
    if (warpCount < 0 || warpCount > 200 || pos + warpCount * 12 > subBuf.length) return null;
    return { warpsOff: pos, warpCount };
  } catch { return null; }
}

const fileInfo = []; // par index de fichier d'evenements
for (let i = 0; i < subFat.length; i++) {
  const [s, e] = subFat[i];
  const absSubStart = narcStart + dataStart + s;
  const subBuf = rom.subarray(absSubStart, narcStart + dataStart + e);
  const w = parseWarps(subBuf);
  if (!w || w.warpCount === 0) { fileInfo.push(null); continue; }
  fileInfo.push({ warpCount: w.warpCount, absWarp0DestMap: absSubStart + w.warpsOff + 4, absWarp0Anchor: absSubStart + w.warpsOff + 6 });
}

const EXCLUDE_RE = /_UNUSED|^EVERYWHERE$|^NOTHING$|^ID_MAX$|^UNUSED$|^UNION$|^WIFI_|^DIRECT[24]$|^UNDERGROUND$/;
const HUB_HEADER = 60; // MAP_NEW_BARK -- la ville avec le labo
const HUB_FILE = eventsBank(HUB_HEADER); // 57

// Cartes signalees en jeu comme atterrissage casse (ecran noir a l'arrivee) --
// probablement le meme phenomene que la "zone de securite asymetrique" deja
// observe avec le hack de vol : certaines coordonnees ne chargent pas bien
// les chunks voisins lors d'un teleport direct (par opposition a une marche
// progressive). On les retire des ETAPES de la tournee (jamais modifiees en
// tant que source), la chaine saute simplement par-dessus.
const KNOWN_BAD_LANDING = new Set([
  27, // ROUTE_22 -- ecran noir a l'arrivee (signale par l'utilisateur)
]);

const candidates = [];
const seenFile = new Set([HUB_FILE]);
for (let h = 0; h < HEADER_COUNT; h++) {
  if (h === HUB_HEADER) continue;
  if (KNOWN_BAD_LANDING.has(h)) continue;
  const name = names[h] || ('H' + h);
  if (EXCLUDE_RE.test(name)) continue;
  const ef = eventsBank(h);
  if (ef === 0) continue;
  const fi = fileInfo[ef];
  if (!fi) continue;
  if (seenFile.has(ef)) continue;
  seenFile.add(ef);
  candidates.push({ h, name, ef });
}
console.log(`hub: header ${HUB_HEADER} (${names[HUB_HEADER]}) -> fichier ${HUB_FILE}`);
console.log(`candidats: ${candidates.length} / ${HEADER_COUNT} headers`);

function patch(absOffset, destMap, anchor) {
  buf.writeUInt16LE(destMap, absOffset);
  buf.writeUInt16LE(anchor, absOffset + 2);
}

// porte du labo (Bourgeon) -> premiere carte de la tournee
patch(fileInfo[HUB_FILE].absWarp0DestMap, candidates[0].h, 0);

for (let k = 0; k < candidates.length; k++) {
  const cur = candidates[k];
  const next = (k + 1 < candidates.length) ? candidates[k + 1].h : HUB_HEADER;
  patch(fileInfo[cur.ef].absWarp0DestMap, next, 0);
}

fs.writeFileSync(outPath, buf);
console.log(`ROM ecrite: ${outPath} (${buf.length} octets)`);

if (orderOutPath) {
  fs.writeFileSync(orderOutPath, JSON.stringify({ hubHeader: HUB_HEADER, order: candidates.map(c => ({ h: c.h, name: c.name })) }));
  console.log(`ordre ecrit: ${orderOutPath} (${candidates.length} entrees)`);
}
