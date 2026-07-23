// Extrait la collision d'un intérieur : header -> matrixId -> matrice a/0/4/1
// -> land file(s) a/0/6/5 -> tuiles praticables (coords locales). Trouve
// l'offset matrixId par force brute (u16 du header pointant vers une petite
// matrice cohérente). Puis choisit N points praticables loin des warps.
// Usage: node interior-collision.js <header> <eventsBank> [N]
const fs = require('fs');

const ROM = 'C:/Users/tayka/Documents/Project_Taykaro_INC/Pokemon - Version Argent SoulSilver (France)/Pokemon - Version Argent SoulSilver (France).nds';
const HDRDUMP = 'C:/Users/tayka/Documents/Project_Taykaro_INC/gamepacks/hgss/headers_dump.bin';
const WARPS = 'C:/Users/tayka/AppData/Local/Temp/claude/C--Users-tayka-Documents-Project-Taykaro-INC/01ebbd3d-3303-4489-a26f-4de6d0ff2046/scratchpad/warps.json';

const header = parseInt(process.argv[2], 10);
const bank = parseInt(process.argv[3], 10);
const N = parseInt(process.argv[4] || '6', 10);

const rom = fs.readFileSync(ROM);
const hdr = fs.readFileSync(HDRDUMP);
const warps = require(WARPS);

const fntOff = rom.readUInt32LE(0x40), fatOff = rom.readUInt32LE(0x48);
function readDir(d){const eo=fntOff+(d&0xfff)*8;let s=fntOff+rom.readUInt32LE(eo);let fid=rom.readUInt16LE(eo+4);const es=[];for(;;){const tl=rom[s++];if(tl===0)break;const iD=(tl&0x80)!==0;const l=tl&0x7f;const n=rom.toString('ascii',s,s+l);s+=l;if(iD){es.push({name:n,dirId:rom.readUInt16LE(s)});s+=2;}else es.push({name:n,fileId:fid++});}return es;}
function findFile(ps){let d=0xf000;for(let i=0;i<ps.length;i++){const e=readDir(d).find(x=>x.name===ps[i]);if(i===ps.length-1){const s=rom.readUInt32LE(fatOff+e.fileId*8);return rom.subarray(s,rom.readUInt32LE(fatOff+e.fileId*8+4));}d=e.dirId;}}
function narc(b){let o=0x10;const bs=b.readUInt32LE(o+4);const c=b.readUInt32LE(o+8);const fat=[];for(let i=0;i<c;i++)fat.push([b.readUInt32LE(o+12+i*8),b.readUInt32LE(o+16+i*8)]);o+=bs;o+=b.readUInt32LE(o+4);const ds=o+8;return fat.map(([s,e])=>b.subarray(ds+s,ds+e));}
function permsOf(lf){let off=16;if(lf.readUInt16LE(off)===0x1234)off+=4+lf.readUInt16LE(off+2);return lf.subarray(off,off+2048);}

const mnarc = narc(findFile(['a','0','4','1']));
const lnarc = narc(findFile(['a','0','6','5']));

function tryMatrix(id) {
  if (id >= mnarc.length) return null;
  const m = mnarc[id];
  if (m.length < 5) return null;
  const W = m[0], H = m[1];
  if (W < 1 || W > 20 || H < 1 || H > 20) return null; // intérieur = petit
  const nameLen = m[4];
  const need = 5 + nameLen + (m[2] ? W*H*2 : 0) + (m[3] ? W*H : 0) + W*H*2;
  if (m.length < need) return null;
  return { m, W, H, nameLen };
}

// force brute sur l'offset matrixId dans les 24 octets du header
let found = null;
for (let off = 0; off <= 22; off += 2) {
  const id = hdr.readUInt16LE(header*24 + off);
  const t = tryMatrix(id);
  if (t) { found = { off, id, ...t }; break; }
}
if (!found) { console.error('matrixId introuvable'); process.exit(1); }
console.log(`header ${header}: matrixId=${found.id} (offset +${found.off}), matrice ${found.W}x${found.H}`);

const { m, W, H, nameLen } = found;
const landBase = 5 + nameLen + (m[2] ? W*H*2 : 0) + (m[3] ? W*H : 0);
const SURF = new Set([16,17,18,19,20,21,25,42,80,81,82,83,115,120,124]);
const DOORS = new Set([0x65,0x66,0x67,0x68,0x69,0x6a,0x6b,0x6c,0x6d,0x6e,0x6f]);

// grille de praticabilité en coords locales (GW x GH)
const GW = W*32, GH = H*32;
const passable = (gx, gy) => {
  if (gx<0||gy<0||gx>=GW||gy>=GH) return false;
  const cx = gx>>5, cy = gy>>5;
  const land = m.readUInt16LE(landBase + (cy*W+cx)*2);
  if (land === 0xffff || land >= lnarc.length) return false;
  const p = permsOf(lnarc[land]);
  const i = ((gy&31)*32 + (gx&31))*2;
  return (p[i+1] & 0x80) === 0 && !SURF.has(p[i]) && !DOORS.has(p[i]);
};

// warps = portes/escaliers de la salle
const doorPts = (warps[bank] && warps[bank].warps || []).map(w => [w.px, w.py]);

// flood-fill 4-connexe depuis les warps : ne garde que la zone réellement
// accessible (élimine les tuiles "praticables" parasites hors grotte).
const seen = new Set();
const key = (x,y) => x + ',' + y;
const stack = [];
for (const [wx, wy] of doorPts) {
  for (const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx=wx+dx, ny=wy+dy;
    if (passable(nx,ny) && !seen.has(key(nx,ny))) { seen.add(key(nx,ny)); stack.push([nx,ny]); }
  }
}
while (stack.length) {
  const [x,y] = stack.pop();
  for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx=x+dx, ny=y+dy;
    if (passable(nx,ny) && !seen.has(key(nx,ny))) { seen.add(key(nx,ny)); stack.push([nx,ny]); }
  }
}
const walk = [...seen].map(s => s.split(',').map(Number));
console.log(`tuiles accessibles (flood-fill depuis les portes) : ${walk.length}`);
const d2 = (a,b) => (a[0]-b[0])**2 + (a[1]-b[1])**2;
function minDoorDist(p){ return Math.min(...doorPts.map(d => d2(p,d)), Infinity); }

// sélection : max-min distance entre eux ET loin des portes.
// on démarre par la tuile la plus éloignée de toute porte.
const picked = [];
const pickedSet = new Set();
let start = walk[0], best = -1;
for (const p of walk) { const d = minDoorDist(p); if (d > best) { best = d; start = p; } }
picked.push(start); pickedSet.add(key(start[0], start[1]));
while (picked.length < N && picked.length < walk.length) {
  let cand = null, cbest = -1;
  for (const p of walk) {
    if (pickedSet.has(key(p[0], p[1]))) continue; // jamais deux fois le même point
    const spread = Math.min(...picked.map(q => d2(p,q)));
    const doorFar = minDoorDist(p);
    const score = spread + doorFar * 0.2; // surtout écartés entre eux ; léger biais anti-porte (pas besoin d'être LOIN, juste pas tous à la porte)
    if (score > cbest) { cbest = score; cand = p; }
  }
  if (!cand) break;
  picked.push(cand); pickedSet.add(key(cand[0], cand[1]));
}
console.log('points choisis (x,y locaux ; dist min. porte en tuiles) :');
for (const p of picked) console.log(`  ${p[0]},${p[1]}   (${Math.round(Math.sqrt(minDoorDist(p)))} de la porte la plus proche)`);
console.log('\nARGS:', picked.map(p => p.join(',')).join(' '));
