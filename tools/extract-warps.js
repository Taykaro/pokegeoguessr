// Extrait la table des warps de chaque map depuis le NARC event data a/0/3/2.
// Format (décodé depuis le code du randomizer hgss-map-randomizer) :
//   [u32 BGS count][count*0x14]
//   [u32 OBJ count][count*0x20]
//   [u32 WARP count][ warps: chacun 12o = u32 position, u16 destMap, u16 anchor, u32 height ]
// Sortie : scratchpad/warps.json (par fichier event : liste de warps + offset section).
const fs = require('fs');
const path = require('path');

const romPath = process.argv[2];
const outPath = process.argv[3] || path.join(__dirname, '..', '..', '..', 'AppData', 'Local', 'Temp',
  'claude', 'C--Users-tayka-Documents-Project-Taykaro-INC', 'dadeb24f-3296-41a7-99c1-278b24c66d39', 'scratchpad', 'warps.json');
const rom = fs.readFileSync(romPath);
const fntOff = rom.readUInt32LE(0x40), fatOff = rom.readUInt32LE(0x48);
function readDir(d){const eo=fntOff+(d&0xfff)*8;let s=fntOff+rom.readUInt32LE(eo);let fid=rom.readUInt16LE(eo+4);const es=[];for(;;){const tl=rom[s++];if(tl===0)break;const iD=(tl&0x80)!==0;const l=tl&0x7f;const n=rom.toString('ascii',s,s+l);s+=l;if(iD){es.push({name:n,dirId:rom.readUInt16LE(s)});s+=2;}else es.push({name:n,fileId:fid++});}return es;}
function findFile(ps){let d=0xf000;for(let i=0;i<ps.length;i++){const e=readDir(d).find(x=>x.name===ps[i]);if(i===ps.length-1){const s=rom.readUInt32LE(fatOff+e.fileId*8);return rom.subarray(s,rom.readUInt32LE(fatOff+e.fileId*8+4));}d=e.dirId;}}
function narc(b){let o=0x10;const bs=b.readUInt32LE(o+4);const c=b.readUInt32LE(o+8);const fat=[];for(let i=0;i<c;i++)fat.push([b.readUInt32LE(o+12+i*8),b.readUInt32LE(o+16+i*8)]);o+=bs;o+=b.readUInt32LE(o+4);const ds=o+8;return fat.map(([s,e])=>b.subarray(ds+s,ds+e));}

const events = narc(findFile(['a','0','3','2']));
console.log(`event files: ${events.length}`);

const out = [];
let totalWarps = 0;
for (let i = 0; i < events.length; i++) {
  const e = events[i];
  let pos = 0;
  try {
    const bgs = e.readUInt32LE(pos); pos += 4 + bgs * 0x14;
    const obj = e.readUInt32LE(pos); pos += 4 + obj * 0x20;
    const warpCount = e.readUInt32LE(pos); pos += 4;
    if (warpCount < 0 || warpCount > 200 || pos + warpCount * 12 > e.length) { out.push(null); continue; }
    const warpsOff = pos;
    const warps = [];
    for (let w = 0; w < warpCount; w++) {
      const position = e.readUInt32LE(pos);
      const destMap = e.readUInt16LE(pos + 4);
      const anchor = e.readUInt16LE(pos + 6);
      const height = e.readUInt32LE(pos + 8);
      // décodage position : essaie {u16 x, u16 y}
      const px = position & 0xffff, py = (position >>> 16) & 0xffff;
      warps.push({ position, px, py, destMap, anchor, height });
      pos += 12;
    }
    totalWarps += warpCount;
    out.push({ file: i, bgs, obj, warpCount, warpsOff, warps });
  } catch { out.push(null); }
}
console.log(`total warps: ${totalWarps}`);
// aperçu de quelques fichiers riches en warps
const rich = out.filter(Boolean).sort((a,b)=>b.warpCount-a.warpCount).slice(0,3);
for (const f of rich) {
  console.log(`\nfile ${f.file}: ${f.warpCount} warps (section @0x${f.warpsOff.toString(16)})`);
  for (const w of f.warps.slice(0,6)) console.log(`  pos=0x${w.position.toString(16)} (x=${w.px},y=${w.py}) destMap=${w.destMap} anchor=${w.anchor}`);
}
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`\nécrit: ${outPath}`);
