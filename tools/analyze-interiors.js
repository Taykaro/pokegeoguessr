// Analyse : (1) les étages/salles sont-ils des headers séparés ?
// (2) combien de points d'arrivée (warps/anchors) par intérieur ?
// Source : headers_dump.bin (541x24, eventsBank u16 @ +16) + warps.json.
const fs = require('fs');

const hdr = fs.readFileSync('C:/Users/tayka/Documents/Project_Taykaro_INC/gamepacks/hgss/headers_dump.bin');
const names = JSON.parse(fs.readFileSync('C:/Users/tayka/Documents/Project_Taykaro_INC/gamepacks/hgss/map_names.json'));
const warps = require('C:/Users/tayka/AppData/Local/Temp/claude/C--Users-tayka-Documents-Project-Taykaro-INC/01ebbd3d-3303-4489-a26f-4de6d0ff2046/scratchpad/warps.json');

const HN = 541;
function eventsBank(h) { return hdr.readUInt16LE(h * 24 + 16); }

// warps par fichier events
function warpCount(bank) {
  const f = warps[bank];
  return f && f.warps ? f.warps.length : 0;
}

// (1) étages du grand magasin de Doublonville
console.log('=== étages/salles = headers séparés ? ===');
for (let h = 0; h < HN; h++) {
  if (/DEPARTMENT_STORE/.test(names[h] || '')) {
    const b = eventsBank(h);
    console.log(`header ${h} ${names[h]}  eventsBank=${b}  warps=${warpCount(b)}`);
  }
}

// (2) distribution du nombre de points d'arrivée pour tous les intérieurs
console.log('\n=== points d\'arrivée (anchors) par header ===');
let multi = 0, total = 0;
const buckets = {};
for (let h = 0; h < HN; h++) {
  const nm = names[h] || '';
  if (!nm || /EVERYWHERE|NOTHING|UNUSED|UNION|WIFI|DIRECT|UNDERGROUND|MAX/.test(nm)) continue;
  const b = eventsBank(h);
  if (b === 0) continue;
  const w = warpCount(b);
  total++;
  if (w >= 2) multi++;
  const k = w >= 6 ? '6+' : String(w);
  buckets[k] = (buckets[k] || 0) + 1;
}
console.log(`headers exploitables: ${total}, dont >=2 anchors: ${multi}`);
console.log('distribution nb warps:', JSON.stringify(buckets));

// exemples riches en anchors (bons candidats multi-angles)
console.log('\n=== intérieurs à nombreux points d\'arrivée ===');
const rich = [];
for (let h = 0; h < HN; h++) {
  const nm = names[h] || '';
  if (!nm || /EVERYWHERE|NOTHING|UNUSED|UNION|WIFI|DIRECT|UNDERGROUND|MAX/.test(nm)) continue;
  const b = eventsBank(h);
  if (b === 0) continue;
  const w = warpCount(b);
  if (w >= 4) rich.push([h, nm, b, w]);
}
rich.sort((a, c) => c[3] - a[3]);
for (const [h, nm, b, w] of rich.slice(0, 15)) console.log(`  ${nm} (h${h}) : ${w} points`);
