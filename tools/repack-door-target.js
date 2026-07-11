// Repack la ROM avec la porte du labo (Doublonville, warp0 dans l'event file 57)
// redirigée vers <destMap> anchor <anchor>. Réutilise l'arbre romext/ et
// zone_event_unpacked/ déjà extraits (voir _capture_scratch/dspre_ui).
// Nécessite knarc.exe/ndstool.exe (copiés dans WORKDIR) accessibles via cmd.exe.
//
// Usage: node tools/repack-door-target.js <destMap> <anchor> <outNdsPath>
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const [destMapArg, anchorArg, outPath] = process.argv.slice(2);
const destMap = parseInt(destMapArg, 10);
const anchor = parseInt(anchorArg || '0', 10);

const WORKDIR = '/mnt/c/Users/tayka/Documents/Project_Taykaro_INC/_capture_scratch/dspre_ui';
const winPath = (p) => execSync(`wslpath -w "${p}"`).toString().trim();

// 1. Patch event57 (warp0 -> destMap/anchor)
const ev = fs.readFileSync(`${WORKDIR}/event57.bin`);
const out = Buffer.from(ev);
out.writeUInt16LE(destMap, 432 + 4);
out.writeUInt16LE(anchor, 432 + 6);
fs.writeFileSync(`${WORKDIR}/zone_event_unpacked/2_00000057.bin`, out);

// 2. Repack NARC events (knarc)
const narcOut = `${WORKDIR}/zone_event_target.narc`;
const bat1 = `${WORKDIR}/_repack_events.bat`;
fs.writeFileSync(bat1, `@echo off\r\n"${winPath(WORKDIR + '/knarc.exe')}" -p "${winPath(narcOut)}" -d "${winPath(WORKDIR + '/zone_event_unpacked')}"\r\n`);
execSync(`cmd.exe /c "${winPath(bat1)}"`, { stdio: 'inherit' });

// 3. Place NARCs (events modifié + scripts ORIGINAL, jamais retouché) dans l'arbre romext
fs.copyFileSync('/tmp/orig_scripts_narc.bin', `${WORKDIR}/romext/data/a/0/1/2`);
fs.copyFileSync(narcOut, `${WORKDIR}/romext/data/a/0/3/2`);

// 4. Repack la ROM (ndstool)
const romOut = `${WORKDIR}/_target.nds`;
const bat2 = `${WORKDIR}/_repack_rom.bat`;
fs.writeFileSync(bat2, [
  '@echo off',
  `"${winPath(WORKDIR + '/ndstool.exe')}" -c "${winPath(romOut)}" -9 "${winPath(WORKDIR + '/romext/arm9.bin')}" -7 "${winPath(WORKDIR + '/romext/arm7.bin')}" -y9 "${winPath(WORKDIR + '/romext/y9.bin')}" -y7 "${winPath(WORKDIR + '/romext/y7.bin')}" -d "${winPath(WORKDIR + '/romext/data')}" -y "${winPath(WORKDIR + '/romext/overlay')}" -t "${winPath(WORKDIR + '/romext/banner.bin')}" -h "${winPath(WORKDIR + '/romext/header.bin')}"`,
].join('\r\n') + '\r\n');
execSync(`cmd.exe /c "${winPath(bat2)}"`, { stdio: 'inherit' });

// 5. Padding a 128 Mio + placement au nom attendu par BizHawk (meme nom que la ROM originale)
const TARGET_SIZE = 134217728;
const raw = fs.readFileSync(romOut);
const padded = raw.length < TARGET_SIZE ? Buffer.concat([raw, Buffer.alloc(TARGET_SIZE - raw.length, 0xff)]) : raw;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, padded);

console.log(`destMap=${destMap} anchor=${anchor} -> ${outPath} (${padded.length} octets)`);
