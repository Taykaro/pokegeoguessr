// Filtre les captures automatiques : détecte les screenshots quasi-noirs
// (zones hors-design de la matrice, jamais censées être vues en jeu normal)
// via la fraction de pixels sombres dans la moitié haute de l'image (jeu,
// sans le bandeau menu du bas). Écrit un manifest filtré à côté de l'original.
//
// Usage: node tools/filter-photos.js <dossierPhotos> <manifest.csv> [seuil=0.4]
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const photoDir = process.argv[2];
const manifestPath = process.argv[3];
const threshold = parseFloat(process.argv[4] || '0.4');

const darkFraction = (filePath) => {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  const H = Math.floor(png.height / 2); // ignore le bandeau menu (moitié basse)
  let dark = 0, total = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < png.width; x++) {
      const o = (y * png.width + x) * 4;
      const lum = png.data[o] * 0.3 + png.data[o + 1] * 0.59 + png.data[o + 2] * 0.11;
      if (lum < 10) dark++;
      total++;
    }
  }
  return dark / total;
};

const lines = fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const validOut = [];
const invalidOut = [];
for (const line of lines) {
  const [idx, reqX, reqY, gotX, gotY, fname] = line.split(',');
  const fp = path.join(photoDir, fname);
  if (!fs.existsSync(fp)) { invalidOut.push(line + ',fichier_absent'); continue; }
  const frac = darkFraction(fp);
  if (frac > threshold) {
    invalidOut.push(line + `,sombre_${(frac * 100).toFixed(0)}pct`);
  } else {
    validOut.push(line);
  }
}

fs.writeFileSync(manifestPath.replace(/\.csv$/, '.valid.csv'), validOut.join('\n'));
fs.writeFileSync(manifestPath.replace(/\.csv$/, '.invalid.csv'), invalidOut.join('\n'));
console.log(`valides: ${validOut.length}, invalides (rejetées): ${invalidOut.length}`);
