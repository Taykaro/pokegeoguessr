// Échantillonne des points praticables dans walkmask.png sur une grille
// régulière (coordonnées jeu, 1:1 avec les pixels de l'image) pour produire
// une liste de cibles pour la capture automatique de photos.
//
// Usage: node tools/sample-targets.js [step] [outPath]
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const step = parseInt(process.argv[2] || '8', 10);
const outPath = process.argv[3] || path.join(__dirname, '..', 'gamepacks', 'hgss', 'targets.json');

const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, '..', 'gamepacks', 'hgss', 'walkmask.png')));
// Accessible en jeu (à pied OU en Surf) = tout ce qui n'est pas noir. Le fait
// que le perso ne soit pas visuellement "en Surf" sur la capture n'a pas
// d'importance : ce qui compte c'est que le lieu soit atteignable par un
// vrai joueur pour gagner la manche.
const isWalkable = (x, y) => {
  const o = (y * png.width + x) * 4;
  return png.data[o] > 50 || png.data[o + 2] > 50;
};

const targets = [];
for (let gy = 0; gy < png.height; gy += step) {
  for (let gx = 0; gx < png.width; gx += step) {
    if (isWalkable(gx, gy)) targets.push({ x: gx, y: gy });
  }
}

fs.writeFileSync(outPath, JSON.stringify(targets));
const csvPath = outPath.replace(/\.json$/, '.csv');
fs.writeFileSync(csvPath, targets.map((t) => `${t.x},${t.y}`).join('\n'));
console.log(`pas=${step} -> ${targets.length} cibles écrites dans ${outPath} et ${csvPath}`);
