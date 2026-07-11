// Persiste les captures d'un dossier batch (scratchpad) dans le repo + manifeste.
// Copie les spot_*.png et écrit manifest.csv (fichier,zone,header,anchor,x,y) +
// resume.txt (nb de photos par lieu).
// Usage: node tools/export-captures.js <scratch_dir> <repo_out_dir>
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });

const rf = path.join(SRC, 'results.jsonl');
const rows = [];
for (const line of fs.readFileSync(rf, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let r; try { r = JSON.parse(line); } catch { continue; }
  if (!r.ok) continue;
  const c = r.obtenu || r.pos || [r.x, r.y];
  // intérieurs : spot_<id>_<zone>_a<anchor>.png ; extérieurs : spot_<id>_<zone>.png
  const fn = (r.anchor !== undefined && r.anchor !== null)
    ? `spot_${String(r.id).padStart(3, '0')}_${r.zone}_a${r.anchor}.png`
    : `spot_${String(r.id).padStart(3, '0')}_${r.zone}.png`;
  const fp = path.join(SRC, fn);
  if (!fs.existsSync(fp)) continue;
  fs.copyFileSync(fp, path.join(OUT, fn));
  rows.push({ file: fn, zone: r.zone, hdr: r.hdr ?? '', anchor: r.anchor ?? '', x: c[0], y: c[1] });
}

const csv = 'fichier,zone,header,anchor,x,y\n' +
  rows.map(r => `${r.file},${r.zone},${r.hdr},${r.anchor},${r.x},${r.y}`).join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'manifest.csv'), csv);

// résumé : photos par lieu, trié
const per = {};
for (const r of rows) per[r.zone] = (per[r.zone] || 0) + 1;
const zones = Object.entries(per).sort((a, b) => b[1] - a[1]);
const resume = `${rows.length} photos, ${zones.length} lieux\n\n` +
  zones.map(([z, n]) => `${String(n).padStart(3)}  ${z}`).join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'resume.txt'), resume);

console.log(`${rows.length} photos copiées -> ${OUT}`);
console.log(`manifest.csv + resume.txt écrits`);
console.log(`lieux: ${zones.length}`);
