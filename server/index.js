const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { loadPack } = require('./pack');
const { Room } = require('./game');

const config = require('../config.json');
const packName = process.env.PACK || config.pack;
const pack = loadPack(path.join(__dirname, '..', 'gamepacks', packName));
console.log(
  `Pack chargé : "${pack.name}" (${pack.widthTiles}x${pack.heightTiles} tuiles, zooms: ${pack.zoomLevels.join(', ')}px)`
);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server);

// Normalise un filtre reçu du client (région / type de lieu).
function sanitizeFilter(f) {
  f = f || {};
  const region = ['all', 'johto', 'kanto'].includes(f.region) ? f.region : 'all';
  const type = ['all', 'ext', 'int'].includes(f.type) ? f.type : 'all';
  return { region, type };
}

const rooms = new Map();
function getRoom(name, filter) {
  const key = String(name || 'main').toLowerCase();
  // Le filtre n'est appliqué qu'à la CRÉATION (choix du créateur de la room).
  if (!rooms.has(key)) rooms.set(key, new Room(io, key, pack, config, sanitizeFilter(filter)));
  return rooms.get(key);
}

io.on('connection', (socket) => {
  let joined = null; // { room, name }

  socket.on('join', ({ name, room, admin, filter }, ack) => {
    name = String(name || '').trim().slice(0, 20);
    if (!name) return ack && ack({ ok: false, error: 'Pseudo requis' });
    const r = getRoom(room, filter);
    joined = { room: r, name, admin: !!admin };
    r.addPlayer(socket, name);
    if (admin) r.addAdmin(socket);
    if (ack) ack({ ok: true, state: r.publicState(), admin: !!admin, adminKey: admin ? r.adminKey : undefined });
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

  // Abandon volontaire : quitte la room proprement (contrairement à une
  // déconnexion réseau qui garde la place pour se reconnecter).
  socket.on('leave', () => {
    if (joined) { joined.room.leaveRoom(socket.id); joined = null; }
  });

  // Position envoyée par le simulateur web (ou tout client socket).
  socket.on('pos', ({ mapID, x, y }) => {
    if (joined) joined.room.handlePos(joined.name, mapID, x, y);
  });

  socket.on('disconnect', () => {
    if (joined) joined.room.removePlayer(socket.id);
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

// Carte complète — uniquement pour le pack de test (simulateur). Jamais pour un vrai pack.
app.get('/simmap', (req, res) => {
  if (!pack.simFullMap) return res.status(403).send('Pas disponible pour ce pack');
  res.set('Content-Type', 'image/png');
  res.send(pack.fullMapBuffer());
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
