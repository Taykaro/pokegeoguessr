// BFS sur walkmask.png (coordonnées jeu, 1:1 avec les pixels) pour trouver un
// chemin à pied entre deux points, ou du point de départ jusqu'à la case Surf
// (eau) la plus proche si --to-water est utilisé à la place de x2,y2.
//
// Usage: node tools/pathfind.js <x1> <y1> <x2> <y2>
//        node tools/pathfind.js <x1> <y1> --to-water
const fs = require('fs');
const { PNG } = require('pngjs');

const [x1s, y1s, x2s, y2s] = process.argv.slice(2);
const x1 = parseInt(x1s, 10), y1 = parseInt(y1s, 10);
const toWater = x2s === '--to-water';

const png = PNG.sync.read(fs.readFileSync('gamepacks/hgss/walkmask.png'));
const W = png.width, H = png.height;

const cellType = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return 0; // bloque
  const o = (y * W + x) * 4;
  if (png.data[o] > 200) return 1; // a pied
  if (png.data[o + 2] > 200) return 2; // surf/eau
  return 0;
};

const isWalkable = (x, y) => cellType(x, y) === 1;
const isWater = (x, y) => cellType(x, y) === 2;

if (!isWalkable(x1, y1)) {
  console.error(`ATTENTION: le depart (${x1},${y1}) n'est pas marque "a pied" dans le masque (type=${cellType(x1,y1)})`);
}

const target = toWater ? null : { x: parseInt(x2s, 10), y: parseInt(y2s, 10) };

// BFS
const key = (x, y) => `${x},${y}`;
const visited = new Set([key(x1, y1)]);
const prev = new Map();
const queue = [[x1, y1]];
let found = null;
const dirs = [[0, -1, 'Up'], [0, 1, 'Down'], [-1, 0, 'Left'], [1, 0, 'Right']];

while (queue.length && !found) {
  const [x, y] = queue.shift();
  for (const [dx, dy, dirName] of dirs) {
    const nx = x + dx, ny = y + dy;
    const k = key(nx, ny);
    if (visited.has(k)) continue;
    if (toWater && isWater(nx, ny)) {
      prev.set(k, [x, y, dirName]);
      found = [nx, ny];
      break;
    }
    if (!isWalkable(nx, ny)) continue;
    visited.add(k);
    prev.set(k, [x, y, dirName]);
    queue.push([nx, ny]);
    if (target && nx === target.x && ny === target.y) { found = [nx, ny]; break; }
  }
  if (queue.length > 2000000) { console.error('BFS trop long, abandon'); process.exit(1); }
}

if (!found) {
  console.error('aucun chemin trouve');
  process.exit(1);
}

// reconstruit le chemin (liste de directions)
const path = [];
let cur = key(found[0], found[1]);
while (cur !== key(x1, y1)) {
  const [px, py, dirName] = prev.get(cur);
  path.push(dirName);
  cur = key(px, py);
}
path.reverse();

console.log(`chemin (${path.length} pas) de (${x1},${y1}) a (${found[0]},${found[1]}):`);
console.log(path.join(','));

// compresse en repetitions "Direction xN"
const compressed = [];
for (const d of path) {
  if (compressed.length && compressed[compressed.length - 1].dir === d) compressed[compressed.length - 1].n++;
  else compressed.push({ dir: d, n: 1 });
}
console.log('compresse:', compressed.map((c) => `${c.dir}x${c.n}`).join(' '));
