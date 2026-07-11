// Ajoute un script "Warp(map,0,x,y,dir); End" à la fin d'un fichier de scripts
// HGSS (format: table d'offsets relatifs u32, terminée par un marqueur u16
// 0xFD13, puis le bytecode de chaque script). N'a besoin de comprendre AUCUN
// script existant : pure arithmétique de table d'offsets (append-only, sûr).
//
// Usage: node tools/inject-warp-script.js <in.bin> <out.bin> <mapId> <x> <y> <dir>
const fs = require('fs');

const [inPath, outPath, mapIdArg, xArg, yArg, dirArg] = process.argv.slice(2);
if (!inPath || !outPath || mapIdArg === undefined) {
  console.error('Usage: node tools/inject-warp-script.js <in.bin> <out.bin> <mapId> <x> <y> <dir>');
  process.exit(1);
}
const mapId = parseInt(mapIdArg, 10);
const x = parseInt(xArg, 10);
const y = parseInt(yArg, 10);
const dir = parseInt(dirArg, 10) || 0;

const raw = fs.readFileSync(inPath);

// 1. Parcourt la table d'offsets jusqu'au marqueur 0xFD13
let p = 0;
const deltas = [];
while (true) {
  const checker = raw.readUInt16LE(p);
  if (checker === 0xFD13) break;
  deltas.push(raw.readUInt32LE(p));
  p += 4;
}
const N = deltas.length;
const rest = raw.subarray(N * 4); // marqueur + tout le bytecode existant, inchangé

// 2. Nouveau bytecode : Warp(mapId, 0, x, y, dir) ; End
//    Warp = opcode 0x00B0, args u16 x5 ; End = opcode 0x0002
const newScript = Buffer.alloc(14);
newScript.writeUInt16LE(0x00b0, 0);
newScript.writeUInt16LE(mapId, 2);
newScript.writeUInt16LE(0, 4); // door
newScript.writeUInt16LE(x, 6);
newScript.writeUInt16LE(y, 8);
newScript.writeUInt16LE(dir, 10);
newScript.writeUInt16LE(0x0002, 12); // End

// 3. Reconstruit : table agrandie (chaque delta existant +4) + nouvelle entrée
//    (delta = rest.length, cf. calcul) + rest inchangé + nouveau script.
const newTable = Buffer.alloc((N + 1) * 4);
for (let i = 0; i < N; i++) newTable.writeUInt32LE(deltas[i] + 4, i * 4);
newTable.writeUInt32LE(rest.length, N * 4);

const out = Buffer.concat([newTable, rest, newScript]);
fs.writeFileSync(outPath, out);

const newScriptId = N + 1; // 1-indexé, comme utilisé dans les headers de level script
console.log(`scripts existants: ${N}`);
console.log(`nouveau script ID: ${newScriptId}`);
console.log(`taille: ${raw.length} -> ${out.length}`);
console.log(`NEW_SCRIPT_ID=${newScriptId}`);
