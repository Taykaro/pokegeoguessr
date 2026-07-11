// Génère une carte de test 2048x2048 (128x128 tuiles de 16px) avec des repères
// identifiables (routes, lacs, villages, monuments colorés) pour tester le jeu
// complet sans ROM. Déterministe (seed fixe) : tout le monde a la même carte.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SIZE = 2048;
const TILE = 16;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260704);

const png = new PNG({ width: SIZE, height: SIZE });

function setPx(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
}
function fillRect(x, y, w, h, r, g, b) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) setPx(i, j, r, g, b);
}
function fillCircle(cx, cy, rad, r, g, b) {
  for (let j = cy - rad; j <= cy + rad; j++)
    for (let i = cx - rad; i <= cx + rad; i++)
      if ((i - cx) ** 2 + (j - cy) ** 2 <= rad * rad) setPx(i, j, r, g, b);
}

// Herbe : damier de deux verts par tuile, avec variations locales.
for (let ty = 0; ty < SIZE / TILE; ty++) {
  for (let tx = 0; tx < SIZE / TILE; tx++) {
    const v = Math.floor(rnd() * 14);
    const base = (tx + ty) % 2 === 0 ? [88, 168, 80] : [96, 180, 88];
    fillRect(tx * TILE, ty * TILE, TILE, TILE, base[0] + v, base[1] + v, base[2] + v);
  }
}

// Forêts : zones de vert foncé.
for (let k = 0; k < 12; k++) {
  const cx = Math.floor(rnd() * SIZE), cy = Math.floor(rnd() * SIZE);
  const rad = 80 + Math.floor(rnd() * 140);
  for (let n = 0; n < rad * 6; n++) {
    const a = rnd() * Math.PI * 2, d = rnd() * rad;
    fillCircle(Math.floor(cx + Math.cos(a) * d), Math.floor(cy + Math.sin(a) * d), 6, 40, 110, 48);
  }
}

// Lacs bleus.
for (let k = 0; k < 14; k++) {
  const cx = Math.floor(rnd() * SIZE), cy = Math.floor(rnd() * SIZE);
  const rad = 40 + Math.floor(rnd() * 90);
  fillCircle(cx, cy, rad, 64, 128, 232);
  fillCircle(cx - rad / 4, cy - rad / 4, Math.floor(rad / 3), 96, 160, 248);
}

// Routes : quadrillage irrégulier gris clair.
for (let k = 0; k < 7; k++) {
  const y = Math.floor(rnd() * SIZE);
  fillRect(0, y, SIZE, 20, 216, 200, 160);
}
for (let k = 0; k < 7; k++) {
  const x = Math.floor(rnd() * SIZE);
  fillRect(x, 0, 20, SIZE, 216, 200, 160);
}

// Villages : grappes de maisons aux toits colorés.
const roofColors = [
  [216, 64, 64], [64, 96, 216], [232, 160, 32], [160, 64, 200],
  [32, 176, 176], [224, 96, 160], [120, 120, 128], [176, 208, 48],
  [96, 56, 24], [240, 232, 96],
];
roofColors.forEach((roof, idx) => {
  const cx = 150 + Math.floor(rnd() * (SIZE - 300));
  const cy = 150 + Math.floor(rnd() * (SIZE - 300));
  const houses = 5 + Math.floor(rnd() * 6);
  for (let h = 0; h < houses; h++) {
    const hx = cx + Math.floor((rnd() - 0.5) * 160);
    const hy = cy + Math.floor((rnd() - 0.5) * 160);
    fillRect(hx, hy + 12, 28, 16, 200, 200, 200); // murs
    fillRect(hx - 2, hy, 32, 14, roof[0], roof[1], roof[2]); // toit
  }
  // Place centrale unique au village (pour le reconnaître).
  fillRect(cx - 10, cy - 10, 20, 20, roof[0], roof[1], roof[2]);
});

// Monuments : petits losanges de couleurs vives, uniques, dispersés.
for (let k = 0; k < 40; k++) {
  const cx = 30 + Math.floor(rnd() * (SIZE - 60));
  const cy = 30 + Math.floor(rnd() * (SIZE - 60));
  const col = [80 + Math.floor(rnd() * 175), 80 + Math.floor(rnd() * 175), 80 + Math.floor(rnd() * 175)];
  for (let d = 0; d <= 10; d++) {
    fillRect(cx - d, cy - (10 - d), d * 2 + 1, 1, col[0], col[1], col[2]);
    fillRect(cx - d, cy + (10 - d), d * 2 + 1, 1, col[0], col[1], col[2]);
  }
}

const outDir = path.join(__dirname, '..', 'gamepacks', 'testpack');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'map.png'), PNG.sync.write(png));
console.log(`Carte de test générée : ${path.join(outDir, 'map.png')} (${SIZE}x${SIZE})`);
