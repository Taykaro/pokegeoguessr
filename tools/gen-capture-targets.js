// Génère des cibles de capture pour plusieurs zones extérieures.
// Pour chaque header : chunks de la matrice portant ce header, tuiles
// praticables à pied (coll bit7=0, pas une porte, pas de l'eau), 2 points
// écartés. Coordonnées RAM = matrice + (0,28).
// Sorties : targets-multi.json + targets-multi.lua
const fs = require('fs');

const ZONES = [
  [73, 'VIOLET'], [74, 'AZALEA'], [78, 'ECRUTEAK'], [77, 'OLIVINE'],
  [75, 'CIANWOOD'], [87, 'MAHOGANY'], [34, 'ROUTE_30'],
  [49, 'PALLET'], [52, 'CERULEAN'], [54, 'VERMILION'],
];
const PER_ZONE = 2;

const rom = fs.readFileSync('C:/Users/tayka/Documents/Project_Taykaro_INC/Pokemon - Version Argent SoulSilver (France)/Pokemon - Version Argent SoulSilver (France).nds');
const fntOff = rom.readUInt32LE(0x40), fatOff = rom.readUInt32LE(0x48);
function readDir(d){const eo=fntOff+(d&0xfff)*8;let s=fntOff+rom.readUInt32LE(eo);let fid=rom.readUInt16LE(eo+4);const es=[];for(;;){const tl=rom[s++];if(tl===0)break;const iD=(tl&0x80)!==0;const l=tl&0x7f;const n=rom.toString('ascii',s,s+l);s+=l;if(iD){es.push({name:n,dirId:rom.readUInt16LE(s)});s+=2;}else es.push({name:n,fileId:fid++});}return es;}
function findFile(ps){let d=0xf000;for(let i=0;i<ps.length;i++){const e=readDir(d).find(x=>x.name===ps[i]);if(i===ps.length-1){const s=rom.readUInt32LE(fatOff+e.fileId*8);return rom.subarray(s,rom.readUInt32LE(fatOff+e.fileId*8+4));}d=e.dirId;}}
function narc(b){let o=0x10;const bs=b.readUInt32LE(o+4);const c=b.readUInt32LE(o+8);const fat=[];for(let i=0;i<c;i++)fat.push([b.readUInt32LE(o+12+i*8),b.readUInt32LE(o+16+i*8)]);o+=bs;o+=b.readUInt32LE(o+4);const ds=o+8;return fat.map(([s,e])=>b.subarray(ds+s,ds+e));}
function permsOf(lf){let off=16;if(lf.readUInt16LE(off)===0x1234)off+=4+lf.readUInt16LE(off+2);return lf.subarray(off,off+2048);}

const m = narc(findFile(['a','0','4','1']))[0];
const W = m[0], H = m[1], nameLen = m[4];
const hdrBase = 5 + nameLen, landBase = hdrBase + W*H*2 + W*H;
const lnarc = narc(findFile(['a','0','6','5']));

const SURF = new Set([16,17,18,19,20,21,25,42,80,81,82,83,115,120,124]);
const DOORS = new Set([0x65,0x66,0x67,0x68,0x69,0x6a,0x6b,0x6c,0x6d,0x6e,0x6f]);

const out = [];
let id = 0;
for (const [hdr, name] of ZONES) {
  const cand = [];
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    if (m.readUInt16LE(hdrBase + (cy*W+cx)*2) !== hdr) continue;
    const land = m.readUInt16LE(landBase + (cy*W+cx)*2);
    if (land === 0xffff || land >= lnarc.length) continue;
    const p = permsOf(lnarc[land]);
    for (let ly = 0; ly < 32; ly++) for (let lx = 0; lx < 32; lx++) {
      const i = (ly*32 + lx) * 2;
      const type = p[i], coll = p[i+1];
      if ((coll & 0x80) !== 0 || SURF.has(type) || DOORS.has(type)) continue;
      cand.push([cx*32 + lx, cy*32 + ly + 28]); // coord RAM
    }
  }
  if (cand.length < PER_ZONE) { console.log(`!! ${name}: ${cand.length} candidats seulement`); continue; }
  // point le plus central, puis le plus éloigné de lui
  const cxm = cand.reduce((s,c)=>s+c[0],0)/cand.length, cym = cand.reduce((s,c)=>s+c[1],0)/cand.length;
  const d2 = (a,b) => (a[0]-b[0])**2 + (a[1]-b[1])**2;
  const first = cand.reduce((b,c)=>d2(c,[cxm,cym])<d2(b,[cxm,cym])?c:b);
  const second = cand.reduce((b,c)=>d2(c,first)>d2(b,first)?c:b);
  for (const [x,y] of [first, second]) out.push({ id: ++id, name, hdr, x, y });
  console.log(`${name}: ${cand.length} tuiles praticables, cibles (${first}) et (${second})`);
}

fs.writeFileSync(__dirname + '/targets-multi.json', JSON.stringify(out, null, 1));
const lua = 'return {\n' + out.map(t =>
  `  { id = ${t.id}, name = "${t.name}", hdr = ${t.hdr}, x = ${t.x}, y = ${t.y} },`
).join('\n') + '\n}\n';
fs.writeFileSync(__dirname + '/targets-multi.lua', lua);
console.log(`\n${out.length} cibles écrites`);
