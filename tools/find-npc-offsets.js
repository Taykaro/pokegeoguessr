// Trouve empiriquement les offsets x/y dans les entrées OBJ (0x20 octets)
// des fichiers events : pour des petits intérieurs connus, les champs x,y
// doivent être petits (<32) et cohérents pour TOUS les PNJ de la salle.
const fs = require('fs');

const rom = fs.readFileSync('C:/Users/tayka/Documents/Project_Taykaro_INC/Pokemon - Version Argent SoulSilver (France)/Pokemon - Version Argent SoulSilver (France).nds');
const hdr = fs.readFileSync('C:/Users/tayka/Documents/Project_Taykaro_INC/gamepacks/hgss/headers_dump.bin');
const names = JSON.parse(fs.readFileSync('C:/Users/tayka/Documents/Project_Taykaro_INC/gamepacks/hgss/map_names.json'));

const fntOff = rom.readUInt32LE(0x40), fatOff = rom.readUInt32LE(0x48);
function readDir(d){const eo=fntOff+(d&0xfff)*8;let s=fntOff+rom.readUInt32LE(eo);let fid=rom.readUInt16LE(eo+4);const es=[];for(;;){const tl=rom[s++];if(tl===0)break;const iD=(tl&0x80)!==0;const l=tl&0x7f;const n=rom.toString('ascii',s,s+l);s+=l;if(iD){es.push({name:n,dirId:rom.readUInt16LE(s)});s+=2;}else es.push({name:n,fileId:fid++});}return es;}
function findFile(ps){let d=0xf000;for(let i=0;i<ps.length;i++){const e=readDir(d).find(x=>x.name===ps[i]);if(i===ps.length-1){const s=rom.readUInt32LE(fatOff+e.fileId*8);return rom.subarray(s,rom.readUInt32LE(fatOff+e.fileId*8+4));}d=e.dirId;}}
function narc(b){let o=0x10;const bs=b.readUInt32LE(o+4);const c=b.readUInt32LE(o+8);const fat=[];for(let i=0;i<c;i++)fat.push([b.readUInt32LE(o+12+i*8),b.readUInt32LE(o+16+i*8)]);o+=bs;o+=b.readUInt32LE(o+4);const ds=o+8;return fat.map(([s,e])=>b.subarray(ds+s,ds+e));}
const events = narc(findFile(['a','0','3','2']));
const eventsBank = h => hdr.readUInt16LE(h*24+16);

function objs(bank) {
  const e = events[bank];
  let pos = 0;
  const bgs = e.readUInt32LE(pos); pos += 4 + bgs*0x14;
  const objCount = e.readUInt32LE(pos); pos += 4;
  const out = [];
  for (let i = 0; i < objCount; i++) out.push(e.subarray(pos + i*0x20, pos + (i+1)*0x20));
  return out;
}

// petits intérieurs témoins : CP Doublonville (185), labo d'Orme (61), maison joueur (63)
for (const h of [185, 61, 63]) {
  const b = eventsBank(h);
  const list = objs(b);
  console.log(`\n${names[h]} (header ${h}, bank ${b}) : ${list.length} OBJ`);
  // pour chaque offset u16 pair, affiche les valeurs de tous les OBJ
  for (let off = 0; off < 0x20; off += 2) {
    const vals = list.map(o => o.readUInt16LE(off));
    const max = Math.max(...vals);
    if (max < 64) console.log(`  +0x${off.toString(16).padStart(2,'0')}: ${vals.join(',')}`);
  }
}
