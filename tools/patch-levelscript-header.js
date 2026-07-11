// Change l'ID de script déclenché par un trigger donné (type 1=VARIABLEVALUE,
// 2=MAPCHANGE, 3=SCREENRESET, 4=LOADGAME) dans un header de level script HGSS.
// Format : entrées de 5 octets [u8 type][u16 payload][2 octets non utilisés],
// sauf type=1 qui utilise un u32 (offset vers la table de triggers variable).
// Terminé par un octet 0x00.
//
// Usage: node tools/patch-levelscript-header.js <in.bin> <out.bin> <triggerType> <newScriptId>
const fs = require('fs');

const [inPath, outPath, triggerTypeArg, newScriptIdArg] = process.argv.slice(2);
if (!inPath || !outPath || triggerTypeArg === undefined || newScriptIdArg === undefined) {
  console.error('Usage: node tools/patch-levelscript-header.js <in.bin> <out.bin> <triggerType> <newScriptId>');
  process.exit(1);
}
const triggerType = parseInt(triggerTypeArg, 10);
const newScriptId = parseInt(newScriptIdArg, 10);

const raw = fs.readFileSync(inPath);
const out = Buffer.from(raw); // copie modifiable

let p = 0;
let found = false;
while (p + 5 <= out.length) {
  const type = out[p];
  if (type === 0) break;
  if (type === triggerType && triggerType !== 1) {
    const oldId = out.readUInt16LE(p + 1);
    out.writeUInt16LE(newScriptId, p + 1);
    console.log(`trigger type=${triggerType} a l'offset ${p}: script ${oldId} -> ${newScriptId}`);
    found = true;
    break;
  }
  p += 5;
}

if (!found) {
  console.error(`aucun trigger de type ${triggerType} trouve (ou type=1, non supporte par cet outil)`);
  process.exit(1);
}

fs.writeFileSync(outPath, out);
console.log('ecrit:', outPath);
