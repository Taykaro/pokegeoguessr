// Relais émulateur -> serveur.
// Le script Lua (hgss.lua) écrit la position dans un petit fichier JSON ;
// ce script le surveille et la pousse au serveur.
//
// Usage :
//   node bridge/watch.js --name TonPseudo [--room main]
//     [--server http://localhost:3000] [--file <chemin du pokegeo_pos.json>]
//
// Par défaut, le fichier est cherché à côté de ce script (BizHawk écrit
// pokegeo_pos.json dans le dossier du script Lua, donc dans bridge/).
// Donne --file si tu l'as mis ailleurs.

const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : def;
}

const name = arg('name');
const room = arg('room', 'main');
const server = arg('server', 'http://localhost:3000');
const file = arg('file', path.join(__dirname, 'pokegeo_pos.json'));

if (!name) {
  console.error('Usage: node bridge/watch.js --name TonPseudo [--room main] [--server URL] [--file chemin]');
  process.exit(1);
}

console.log(`Pont PokéGeoGuessr`);
console.log(`  joueur : ${name} | room : ${room}`);
console.log(`  serveur : ${server}`);
console.log(`  fichier : ${file}`);
console.log(`En attente de positions... (le script Lua doit être en MODE="play")`);

let last = '';
let warned = false;

setInterval(async () => {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
    warned = false;
  } catch {
    if (!warned) {
      console.log(`(fichier ${file} introuvable — lance le script Lua, ou passe --file)`);
      warned = true;
    }
    return;
  }
  if (!content || content === last) return;
  let pos;
  try { pos = JSON.parse(content); } catch { return; } // écriture partielle, on retentera
  last = content;
  try {
    const res = await fetch(`${server}/pos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room, name, ...pos }),
    });
    if (!res.ok) console.error(`Serveur a répondu ${res.status}`);
    else process.stdout.write(`\rmap:${pos.mapID} x:${pos.x} y:${pos.y}   `);
  } catch (e) {
    console.error(`Erreur réseau : ${e.message}`);
  }
}, 150);
