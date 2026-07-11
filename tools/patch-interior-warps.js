// Patche EN PLACE (copie ROM) les coordonnées de certains warps d'un intérieur,
// pour créer des points d'arrivée ARBITRAIRES loin des portes. On capture
// ensuite via le sas en visant ces anchors.
// Usage: node patch-interior-warps.js <rom_in> <rom_out> <eventsBank> <x0,y0> <x1,y1> ...
const fs = require('fs');

const [romIn, romOut, bankStr, ...pts] = process.argv.slice(2);
const bank = parseInt(bankStr, 10);
const rom = fs.readFileSync(romIn);
const buf = Buffer.from(rom);

const fntOff = rom.readUInt32LE(0x40), fatOff = rom.readUInt32LE(0x48);
function readDir(d){const eo=fntOff+(d&0xfff)*8;let s=fntOff+rom.readUInt32LE(eo);let fid=rom.readUInt16LE(eo+4);const es=[];for(;;){const tl=rom[s++];if(tl===0)break;const iD=(tl&0x80)!==0;const l=tl&0x7f;const n=rom.toString('ascii',s,s+l);s+=l;if(iD){es.push({name:n,dirId:rom.readUInt16LE(s)});s+=2;}else es.push({name:n,fileId:fid++});}return es;}
function findFileId(ps){let d=0xf000;for(let i=0;i<ps.length;i++){const e=readDir(d).find(x=>x.name===ps[i]);if(i===ps.length-1)return e.fileId;d=e.dirId;}}

const eventsFileId = findFileId(['a','0','3','2']);
const narcStart = rom.readUInt32LE(fatOff + eventsFileId*8);
const narcEnd = rom.readUInt32LE(fatOff + eventsFileId*8 + 4);
const narcBuf = rom.subarray(narcStart, narcEnd);
// parseNarcFat (relatif au NARC), calqué sur build-warp-tour-v2.js
let o = 0x10;
const btafSize = narcBuf.readUInt32LE(o+4);
const count = narcBuf.readUInt32LE(o+8);
const subFat = [];
for (let i=0;i<count;i++) subFat.push([narcBuf.readUInt32LE(o+12+i*8), narcBuf.readUInt32LE(o+16+i*8)]);
o += btafSize; o += narcBuf.readUInt32LE(o+4);
const dataStart = o + 8;

const [s] = subFat[bank];
const absSubStart = narcStart + dataStart + s;
const sub = rom.subarray(absSubStart, narcStart + dataStart + subFat[bank][1]);
// parse jusqu'à la section warps
let pos = 0;
const bgs = sub.readUInt32LE(pos); pos += 4 + bgs*0x14;
const obj = sub.readUInt32LE(pos); pos += 4 + obj*0x20;
const warpCount = sub.readUInt32LE(pos); pos += 4;
const warpsOff = pos;
console.log(`bank ${bank}: ${warpCount} warps, section @0x${warpsOff.toString(16)}`);

pts.forEach((p, k) => {
  if (k >= warpCount) { console.log(`!! anchor ${k} hors limite`); return; }
  const [x, y] = p.split(',').map(Number);
  const absPos = absSubStart + warpsOff + k*12;   // champ position u32 du warp k
  const oldPos = rom.readUInt32LE(absPos);
  const newPos = (x & 0xffff) | ((y & 0xffff) << 16);
  buf.writeUInt32LE(newPos, absPos);
  console.log(`  anchor ${k}: (${oldPos&0xffff},${(oldPos>>>16)&0xffff}) -> (${x},${y})`);
});

fs.writeFileSync(romOut, buf);
console.log(`ROM écrite: ${romOut}`);
