const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { loadPack } = require('./pack');
const { Room } = require('./game');
const stats = require('./stats');

const config = require('../config.json');
const packName = process.env.PACK || config.pack;
const pack = loadPack(path.join(__dirname, '..', 'gamepacks', packName));
console.log(
  `Pack chargé : "${pack.name}" (${pack.widthTiles}x${pack.heightTiles} tuiles, zooms: ${pack.zoomLevels.join(', ')}px)`
);

const app = express();
app.use(express.json());
// Isolation cross-origin pour la page émulateur navigateur (EmulatorJS / WASM
// threads ont besoin de SharedArrayBuffer). Limité à cette page pour ne pas
// impacter le reste du site. COEP credentialless = autorise le CDN sans CORP.
app.use((req, res, next) => {
  if (req.path === '/emu-probe.html' || req.path === '/play.html' || req.path === '/dsa-play.html') {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  }
  next();
});
// Entrée du site : on arrive directement sur le jeu web (le menu joli).
app.get('/', (req, res) => res.redirect('/play.html'));
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server);

// Normalise un filtre reçu du client (région / type de lieu).
function sanitizeFilter(f) {
  f = f || {};
  const region = ['all', 'johto', 'kanto'].includes(f.region) ? f.region : 'all';
  const type = ['all', 'ext', 'int'].includes(f.type) ? f.type : 'all';
  const difficulty = ['facile', 'moyen', 'difficile'].includes(f.difficulty) ? f.difficulty : 'moyen';
  return { region, type, difficulty };
}

const rooms = new Map();
// Options de salon fixées à la création : limite de joueurs + mot de passe.
function sanitizeRoomOpts(o) {
  o = o || {};
  const n = parseInt(o.maxPlayers, 10);
  const maxPlayers = Number.isFinite(n) && n >= 2 && n <= 16 ? n : 0; // 0 = illimité
  const password = String(o.password || '').trim().slice(0, 24);
  return { maxPlayers, password };
}
// Crée une room et branche le hook qui rafraîchit la liste des salons.
function makeRoom(key, filter, opts) {
  const r = new Room(io, key, pack, config, sanitizeFilter(filter), opts || {});
  r.onChange = broadcastRooms;
  rooms.set(key, r);
  return r;
}
function getRoom(name, filter) {
  const key = String(name || 'main').toLowerCase();
  if (!rooms.has(key)) makeRoom(key, filter);
  return rooms.get(key);
}
// Supprime une room vraiment vide (plus aucun joueur mémorisé).
function cleanupRoom(r) {
  if (r && r.players.size === 0) { clearInterval(r.presenceTimer); rooms.delete(r.name); }
}
// Liste des salons ouverts (≥1 joueur actif) pour le navigateur de rooms.
function roomList() {
  const out = [];
  for (const [key, r] of rooms) {
    const active = r.activePlayers();
    if (active.length === 0) continue;
    out.push({
      room: key, host: r.host, players: active.length,
      ready: active.filter((p) => r.isInGame(p)).length,
      max: r.maxPlayers, locked: !!r.password,
      phase: r.phase, difficulty: r.difficulty,
      region: r.filter.region, type: r.filter.type,
    });
  }
  return out.sort((a, b) => a.room.localeCompare(b.room));
}
function broadcastRooms() { io.emit('rooms', roomList()); }
// Balayage : purge les rooms fantômes (0 joueur) et rafraîchit la liste.
setInterval(() => {
  let changed = false;
  for (const [k, r] of rooms) if (r.players.size === 0) { clearInterval(r.presenceTimer); rooms.delete(k); changed = true; }
  if (changed) broadcastRooms();
}, 30000);

io.on('connection', (socket) => {
  let joined = null; // { room, name }
  socket.emit('rooms', roomList()); // liste initiale pour le menu

  const enter = (r, name, admin) => {
    joined = { room: r, name, admin: !!admin };
    stats.recordJoin();
    r.addPlayer(socket, name);
    if (admin) r.addAdmin(socket);
    return { ok: true, state: r.publicState(), admin: !!admin, adminKey: admin ? r.adminKey : undefined };
  };

  socket.on('rooms:get', (ack) => { if (ack) ack(roomList()); });

  // Créer une room (le créateur devient meneur ; réglages figés à la création).
  socket.on('room:create', ({ name, room, filter, maxPlayers, password }, ack) => {
    name = String(name || '').trim().slice(0, 20);
    const key = String(room || '').trim().toLowerCase().slice(0, 20);
    if (!name) return ack && ack({ ok: false, error: 'Pseudo requis' });
    if (!key) return ack && ack({ ok: false, error: 'Nom de room requis' });
    if (rooms.has(key)) return ack && ack({ ok: false, error: 'Cette room existe déjà — rejoins-la' });
    const res = enter(makeRoom(key, filter, sanitizeRoomOpts({ maxPlayers, password })), name);
    stats.recordRoom();
    broadcastRooms();
    if (ack) ack(res);
  });

  // Rejoindre un salon existant (contrôle mot de passe + salon plein).
  socket.on('room:join', ({ name, room, password }, ack) => {
    name = String(name || '').trim().slice(0, 20);
    const key = String(room || '').trim().toLowerCase();
    if (!name) return ack && ack({ ok: false, error: 'Pseudo requis' });
    if (!rooms.has(key)) return ack && ack({ ok: false, error: 'Room introuvable' });
    const r = rooms.get(key);
    if (r.password && String(password || '') !== r.password) return ack && ack({ ok: false, error: 'Mot de passe incorrect', locked: true });
    const existing = r.findPlayerByName(name); // reconnexion (même pseudo) : pas bloquée par la limite
    if (!existing && r.isFull()) return ack && ack({ ok: false, error: 'Salon complet' });
    const res = enter(r, name);
    broadcastRooms();
    if (ack) ack(res);
  });

  // Le meneur lance la partie depuis le salon.
  socket.on('game:start', () => { if (joined) joined.room.startGame(joined.name); });

  // Legacy (exe/bridge) : join qui démarre la partie immédiatement.
  socket.on('join', ({ name, room, admin, filter }, ack) => {
    name = String(name || '').trim().slice(0, 20);
    if (!name) return ack && ack({ ok: false, error: 'Pseudo requis' });
    const r = getRoom(room, filter);
    const res = enter(r, name, admin);
    r.startGame(name); // comportement historique
    broadcastRooms();
    if (ack) ack(res);
  });

  // Admin : passer au round suivant instantanément (pour les tests).
  socket.on('admin:skip', () => {
    if (joined && joined.admin) joined.room.skipRound();
  });

  // N'importe quel joueur : demande à passer. Round suivant seulement quand
  // TOUS les joueurs connectés ont demandé à passer.
  socket.on('pass:request', () => {
    if (joined) joined.room.requestPass(joined.name);
  });

  // N'importe quel joueur : demande à dézoomer. Dézoom immédiat quand TOUS les
  // joueurs connectés l'ont demandé.
  socket.on('zoom:request', () => {
    if (joined) joined.room.requestZoom(joined.name);
  });

  // Abandon volontaire : quitte la room proprement (contrairement à une
  // déconnexion réseau qui garde la place pour se reconnecter).
  socket.on('leave', () => {
    if (joined) { const r = joined.room; r.leaveRoom(socket.id); joined = null; cleanupRoom(r); broadcastRooms(); }
  });

  // Position envoyée par le simulateur web (ou tout client socket).
  socket.on('pos', ({ mapID, x, y }) => {
    if (joined) joined.room.handlePos(joined.name, mapID, x, y);
  });

  socket.on('disconnect', () => {
    if (joined) { joined.room.removePlayer(socket.id); broadcastRooms(); }
  });
});

// Position envoyée par le pont émulateur (bridge/watch.js) en HTTP.
app.post('/pos', (req, res) => {
  const { room, name, mapID, x, y } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name requis' });
  getRoom(room).handlePos(name, mapID, x, y);
  res.json({ ok: true });
});

// Image du round en cours (niveau de zoom actuel uniquement — pas de triche possible).
// L'image PLEINE (?full=1) exige la clé admin de la room : sans elle, impossible
// de deviner l'URL pour voir la réponse (fermé pour tout le monde en ligne, sauf
// un vrai admin qui a rejoint avec le mode admin).
app.get('/img/:room', (req, res) => {
  const r = rooms.get(String(req.params.room).toLowerCase());
  if (!r) return res.status(404).end();
  if (req.query.full && req.query.key !== r.adminKey) return res.status(403).end();
  const img = req.query.full ? r.fullImage() : r.currentImage();
  if (!img) return res.status(404).end();
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-store');
  res.send(img);
});

// Minimap du monde (silhouette) pour la révélation de fin de round. Ne révèle
// aucune cible en soi (juste la carte + positions envoyées au moment du round gagné).
app.get('/minimap', (req, res) => {
  const buf = pack.minimapBuffer && pack.minimapBuffer();
  if (!buf) return res.status(404).end();
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(buf);
});

// Town Map (carte du Pokégear) pour la révélation de fin de round. Ne révèle
// aucune cible en soi (juste la carte de fond ; les positions arrivent par socket).
app.get('/townmap', (req, res) => {
  const buf = pack.townmapBuffer && pack.townmapBuffer();
  if (!buf) return res.status(404).end();
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(buf);
});

// Carte complète — uniquement pour le pack de test (simulateur). Jamais pour un vrai pack.
app.get('/simmap', (req, res) => {
  if (!pack.simFullMap) return res.status(403).send('Pas disponible pour ce pack');
  res.set('Content-Type', 'image/png');
  res.send(pack.fullMapBuffer());
});

// Stats d'activité (parties, manches, lieux joués). Protégé par STATS_KEY (env)
// pour ne pas exposer publiquement. Sans STATS_KEY défini -> endpoint désactivé.
app.get('/api/stats', (req, res) => {
  if (!process.env.STATS_KEY || req.query.key !== process.env.STATS_KEY) return res.status(403).end();
  res.json(stats.snapshot());
});

app.get('/api/pack', (req, res) => {
  res.json({
    name: pack.name,
    tileSize: pack.tileSize,
    widthTiles: pack.widthTiles,
    heightTiles: pack.heightTiles,
    simFullMap: pack.simFullMap,
  });
});

// PORT : celui de l'hébergeur (Render/Fly/… injectent process.env.PORT) sinon config.json.
const PORT = process.env.PORT || config.port;
server.listen(PORT, () => {
  console.log(`PokéGeoGuessr sur http://localhost:${PORT}`);
  console.log(`Simulateur de test : http://localhost:${PORT}/sim.html`);
});
