// Application de bureau PokéGeoGuessr — menu 3 modes + deux fenêtres.
// Écran d'accueil : Solo / Admin / Multi.
//  - Solo/Admin : serveur LOCAL embarqué, position relayée en local.
//  - Multi : l'UI et la position vont vers le serveur DISTANT (que tu déploies),
//            pour jouer avec les potes dans une room.
// BizHawk (avec TA ROM + le pont Lua) est lancé et placé à gauche ; l'objectif
// à droite. Fermer une fenêtre ferme l'autre.
//
// Dév : npm install --save-dev electron  puis  npm run app
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const win32 = require('./win-embed');

const ROOT = __dirname;
// En dev, tout (code ET gros binaires BizHawk/ROM) vit sous ROOT. Une fois
// packagé (electron-builder), le code va dans resources/app/ (=ROOT) mais les
// "extraResources" (BizHawk, ROM, save) vont un cran au-dessus, dans
// resources/ (=process.resourcesPath). EXTRA pointe toujours vers le bon dossier.
const EXTRA = app.isPackaged ? process.resourcesPath : ROOT;
const PORT = require('./config.json').port || 3000;
const LOCAL = `http://localhost:${PORT}`;
const OBJ_W = 440, OBJ_H = 740;
const BIZ_W = 560, BIZ_H = 540;
const GAP = 8;

const BIZHAWK = path.join(EXTRA, 'BizHawk-2.11.1-win-x64', 'EmuHawk.exe');
const ROM = path.join(EXTRA, 'Pokemon - Version Argent SoulSilver (France)', 'Pokemon - Version Argent SoulSilver (France).nds');
const LUA = path.join(ROOT, 'bridge', 'hgss.lua');
const POSFILE = path.join(ROOT, 'bridge', 'pokegeo_pos.json');
const SAVE_SRC = path.join(EXTRA, 'gamepacks', 'hgss', 'soulsilver_fullcs_FR.sav');
const SAVE_DST = path.join(EXTRA, 'BizHawk-2.11.1-win-x64', 'NDS', 'SaveRAM', 'Pokemon - Version Argent SoulSilver (France).SaveRAM');

let emu = null, win = null, watcher = null, placeTimer = null, quitting = false;

function startServer() { require('./server/index'); }

function launchEmulator() {
  try { if (fs.existsSync(SAVE_SRC)) fs.copyFileSync(SAVE_SRC, SAVE_DST); } catch {}
  emu = spawn(BIZHAWK, [`--lua=${LUA}`, ROM], { cwd: ROOT, detached: false });
  emu.on('error', (e) => console.error('Émulateur introuvable :', e.message));
  emu.on('exit', () => { if (!quitting) quitAll(); });
}

// Relaie la position (pont) vers le serveur choisi, sous le pseudo choisi.
function startRelay(server, room, name) {
  clearInterval(watcher);
  let last = '';
  watcher = setInterval(async () => {
    let content;
    try { content = fs.readFileSync(POSFILE, 'utf8'); } catch { return; }
    if (!content || content === last) return;
    let pos; try { pos = JSON.parse(content); } catch { return; }
    last = content;
    try {
      await fetch(`${server}/pos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, name, ...pos }),
      });
    } catch {}
  }, 150);
}

// Choix du mode depuis le menu -> charge l'appli et démarre le bon relais.
function onMode(cfg) {
  let origin, relay, name, room, admin;
  if (cfg.mode === 'multi') {
    origin = String(cfg.server || '').replace(/\/+$/, '');
    relay = origin; name = cfg.name || 'Joueur'; room = cfg.room || 'main'; admin = false;
  } else {
    origin = LOCAL; relay = LOCAL; name = 'Solo'; room = 'main'; admin = (cfg.mode === 'admin');
  }
  const region = cfg.region || 'all', type = cfg.type || 'all', difficulty = cfg.difficulty || 'moyen';
  const url = `${origin}/app.html?name=${encodeURIComponent(name)}&room=${encodeURIComponent(room)}`
    + `${admin ? '&admin=1' : ''}&region=${region}&type=${type}&difficulty=${difficulty}`;
  win.loadURL(url);
  startRelay(relay, room, name);
}

function placeWindows() {
  const wa = screen.getPrimaryDisplay().workArea;
  const sf = screen.getPrimaryDisplay().scaleFactor;
  const totalW = BIZ_W + GAP + OBJ_W;
  const left = wa.x + Math.max(0, Math.floor((wa.width - totalW) / 2));
  const top = wa.y + Math.max(0, Math.floor((wa.height - Math.max(BIZ_H, OBJ_H)) / 2));
  win.setBounds({ x: left + BIZ_W + GAP, y: top, width: OBJ_W, height: OBJ_H });
  let tries = 0, placed = false;
  placeTimer = setInterval(() => {
    tries++;
    let wins = [];
    try { wins = win32.topWindowsOfPid(emu.pid); } catch {}
    for (const w of wins) if (/lua/i.test(w.title)) { try { win32.hide(w.hwnd); } catch {} }
    const main = wins.find((w) => !/lua/i.test(w.title));
    if (main && !placed) {
      placed = true;
      try { win32.move(main.hwnd, Math.round(left * sf), Math.round(top * sf), Math.round(BIZ_W * sf), Math.round(BIZ_H * sf)); } catch {}
    }
    if (tries > 40) clearInterval(placeTimer);
  }, 400);
}

function createWindow() {
  win = new BrowserWindow({
    width: OBJ_W, height: OBJ_H, title: 'PokéGeoGuessr',
    backgroundColor: '#0f1117', autoHideMenuBar: true,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(`${LOCAL}/menu.html`);
  win.on('closed', () => { if (!quitting) quitAll(); });
}

function quitAll() {
  quitting = true;
  clearInterval(watcher); clearInterval(placeTimer);
  if (emu && !emu.killed) { try { emu.kill(); } catch {} }
  app.quit();
}

ipcMain.on('pokegeo:mode', (e, cfg) => onMode(cfg || {}));
ipcMain.on('pokegeo:menu', () => {
  clearInterval(watcher); // on quitte la partie -> plus besoin de relayer la position
  win.loadURL(`${LOCAL}/menu.html`);
});

app.whenReady().then(() => {
  startServer();
  setTimeout(() => {
    createWindow();       // menu 3 modes
    launchEmulator();
    setTimeout(placeWindows, 1500);
  }, 700);
});

app.on('window-all-closed', () => quitAll());
