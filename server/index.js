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

const rooms = new Map();
function getRoom(name) {
  const key = String(name || 'main').toLowerCase();
  if (!rooms.has(key)) rooms.set(key, new Room(io, key, pack, config));
  return rooms.get(key);
}

io.on('connection', (socket) => {
  let joined = null; // { room, name }

  socket.on('join', ({ name, room, admin }, ack) => {
    name = String(name || '').trim().slice(0, 20);
    if (!name) return ack && ack({ ok: false, error: 'Pseudo requis' });
    const r = getRoom(room);
    joined = { room: r, name, admin: !!admin };
    r.addPlayer(socket, name);
    if (admin) r.addAdmin(socket);
    if (ack) ack({ ok: true, state: r.publicState(), admin: !!admin });
  });

  // Admin : passer au round suivant.
  socket.on('admin:skip', () => {
    if (joined && joined.admin) joined.room.skipRound();
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
app.get('/img/:room', (req, res) => {
  const r = rooms.get(String(req.params.room).toLowerCase());
  const img = r && (req.query.full ? r.fullImage() : r.currentImage());
  if (!img) return res.status(404).end();
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-store');
  res.send(img);
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
