// Construit un "pack photo" jouable à partir des captures du batch :
// pour chaque photo réussie, découpe l'écran du HAUT (256x192) et l'enregistre,
// avec ses coordonnées jeu (RAM). Le serveur montrera des zooms de CES photos.
// Usage: node tools/build-photo-pack.js <dossier_scratch> <dir1> [dir2 ...]
//   ex: node tools/build-photo-pack.js .../scratchpad batchrun batchrun2
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SCRATCH = process.argv[2];
const dirs = process.argv.slice(3);
const OUT = path.join(__dirname, '..', 'gamepacks', 'hgss_photos');
fs.mkdirSync(OUT, { recursive: true });

function topCrop(src) {
  const out = new PNG({ width: 256, height: 192 });
  PNG.bitblt(src, out, 0, 0, 256, 192, 0, 0);
  return out;
}

// vrai si l'écran du haut est (quasi) noir/vide -> à exclure du pack
function isBlack(src) {
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) {
    const o = (y * src.width + x) * 4;
    const l = 0.299 * src.data[o] + 0.587 * src.data[o + 1] + 0.114 * src.data[o + 2];
    sum += l; sum2 += l * l; n++;
  }
  const mean = sum / n;
  return mean < 12 || Math.sqrt(sum2 / n - mean * mean) < 4;
}

const photos = [];
let id = 0, skipped = 0;
for (const d of dirs) {
  const dir = path.join(SCRATCH, d);
  const rf = path.join(dir, 'results.jsonl');
  if (!fs.existsSync(rf)) { console.log(`(${d}: pas de results.jsonl)`); continue; }
  for (const line of fs.readFileSync(rf, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!r.ok) continue;
    const coord = r.obtenu || r.pos; // extérieur: obtenu ; intérieur: pos
    if (!coord) continue;
    // fichier capture : extérieur spot_<id>_<zone>.png ; intérieur ..._a<anchor>.png
    const fn = (r.anchor !== undefined && r.anchor !== null)
      ? `spot_${String(r.id).padStart(3, '0')}_${r.zone}_a${r.anchor}.png`
      : `spot_${String(r.id).padStart(3, '0')}_${r.zone}.png`;
    const fp = path.join(dir, fn);
    if (!fs.existsSync(fp)) continue;
    const src = PNG.sync.read(fs.readFileSync(fp));
    if (isBlack(src)) { skipped++; continue; } // écran noir/vide (grotte non éclairée, tuile vide)
    const outName = `${String(id).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(OUT, outName), PNG.sync.write(topCrop(src)));
    // intérieur (r.hdr présent) : coords LOCALES, victoire = (mapID + x + y).
    // extérieur : coords globales uniques, mapID ignoré.
    const interior = (r.hdr !== undefined && r.hdr !== null);
    const photo = { gx: coord[0], gy: coord[1], zone: r.zone, file: outName };
    if (interior) { photo.interior = true; photo.mapID = r.hdr; }
    photos.push(photo);
    id++;
  }
}

const pack = {
  name: 'Pokémon SoulSilver (photos réelles)',
  mode: 'photo',
  tileSize: 1,
  // fenêtres de zoom (largeur px) sur l'écran du haut (256x192) : très zoomé ->
  // plein écran. Le crop est ensuite AGRANDI pour remplir le cadre (côté client).
  zoomLevels: [48, 88, 150, 256],
  marginTiles: 3,
  maps: { '0': { offsetX: 0, offsetY: 0 } }, // extérieur : coords RAM = globales
  photos,
};
fs.writeFileSync(path.join(OUT, 'pack.json'), JSON.stringify(pack, null, 1));
console.log(`pack photo écrit : ${photos.length} photos (${skipped} écrans noirs exclus) -> gamepacks/hgss_photos/`);
console.log(`zones : ${[...new Set(photos.map(p => p.zone))].length}`);
