// Calcule un "tour" (BFS vers plusieurs points extremes) de la zone marchable
// connectee depuis un point de depart, pour prouver la navigation sans mur.
// Usage: node tools/tour-zone.js <trueX> <trueY>
const fs = require('fs');
const { PNG } = require('pngjs');

const [xs, ys] = process.argv.slice(2);
const startX = parseInt(xs, 10), startY = parseInt(ys, 10);

const png = PNG.sync.read(fs.readFileSync('gamepacks/hgss/walkmask.png'));
const W = png.width, H = png.height;
const isWalkable = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const o = (y * W + x) * 4;
  return png.data[o] > 200; // a pied uniquement
};

if (!isWalkable(startX, startY)) {
  console.error(`depart (${startX},${startY}) non marchable !`);
  process.exit(1);
}

// BFS flood-fill : composante connexe + distances/parents pour chemins courts
const key = (x, y) => x + ',' + y;
const dist = new Map([[key(startX, startY), 0]]);
const parent = new Map();
const order = [[startX, startY]];
const queue = [[startX, startY]];
const dirs = [[0, -1, 'Up'], [0, 1, 'Down'], [-1, 0, 'Left'], [1, 0, 'Right']];

while (queue.length) {
  const [x, y] = queue.shift();
  for (const [dx, dy, name] of dirs) {
    const nx = x + dx, ny = y + dy, k = key(nx, ny);
    if (dist.has(k)) continue;
    if (!isWalkable(nx, ny)) continue;
    dist.set(k, dist.get(key(x, y)) + 1);
    parent.set(k, [x, y, name]);
    order.push([nx, ny]);
    queue.push([nx, ny]);
  }
}

console.log(`composante connexe: ${order.length} tuiles`);
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const [x, y] of order) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
console.log(`bbox: x[${minX},${maxX}] y[${minY},${maxY}]`);

// points extremes a visiter (les 4 coins de la bbox les plus proches presents dans order)
function nearestInOrderTo(tx, ty) {
  let best = null, bestD = Infinity;
  for (const [x, y] of order) {
    const d = Math.abs(x - tx) + Math.abs(y - ty);
    if (d < bestD) { bestD = d; best = [x, y]; }
  }
  return best;
}
const targets = [
  nearestInOrderTo(minX, minY),
  nearestInOrderTo(maxX, minY),
  nearestInOrderTo(maxX, maxY),
  nearestInOrderTo(minX, maxY),
  [startX, startY],
];

function pathTo(tx, ty) {
  const path = [];
  let cur = key(tx, ty);
  while (cur !== key(startX, startY) && parent.has(cur)) {
    const [px, py, name] = parent.get(cur);
    path.push(name);
    cur = key(px, py);
  }
  return path.reverse();
}

// tour: depart -> coin1 -> coin2 -> coin3 -> coin4 -> retour depart (chemins directs a chaque fois,
// donc on doit re-BFS a partir de chaque etape ; ici on simplifie en utilisant toujours l'arbre
// BFS depuis le point de depart initial, ce qui donne un aller-retour a chaque coin (moins optimal
// mais garanti dans la composante connexe et facile a verifier pas a pas).
let fullPath = [];
for (const [tx, ty] of targets) {
  const toTarget = pathTo(tx, ty);
  const back = toTarget.map((d) => ({ Up: 'Down', Down: 'Up', Left: 'Right', Right: 'Left' }[d])).reverse();
  fullPath = fullPath.concat(toTarget, back);
}

console.log(`chemin complet: ${fullPath.length} pas`);
fs.writeFileSync('/tmp/tour_path.json', JSON.stringify({ startX, startY, targets, path: fullPath }));
console.log(fullPath.join(','));
