// Logique d'une partie : rounds, dézoom progressif, détection du gagnant.
class Room {
  constructor(io, name, pack, config) {
    this.io = io;
    this.name = name;
    this.pack = pack;
    this.config = config;
    this.players = new Map(); // socketId -> { name, score }
    this.roundNum = 0;
    this.phase = 'waiting'; // waiting | playing | intermission
    this.target = null;
    this.level = 0;
    this.crops = [];
    this.zoomTimer = null;
    this.nextZoomAt = null;
    this.roundStartedAt = null;
  }

  channel() {
    return this.io.to(`room:${this.name}`);
  }

  addPlayer(socket, playerName) {
    // Reconnexion : on garde le score si le même nom revient.
    let score = 0;
    for (const [id, p] of this.players) {
      if (p.name.toLowerCase() === playerName.toLowerCase()) {
        score = p.score;
        this.players.delete(id);
        break;
      }
    }
    this.players.set(socket.id, { name: playerName, score });
    socket.join(`room:${this.name}`);
    if (this.phase === 'waiting') this.startRound();
    this.broadcastState();
  }

  removePlayer(socketId) {
    // On ne supprime pas le joueur : il peut se reconnecter avec son score.
    // On le marque juste déconnecté pour l'affichage.
    const p = this.players.get(socketId);
    if (p) p.offline = true;
    this.broadcastState();
  }

  findPlayerByName(playerName) {
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === String(playerName).toLowerCase()) return p;
    }
    return null;
  }

  startRound() {
    clearTimeout(this.zoomTimer);
    this.roundNum++;
    this.phase = 'playing';
    this.level = 0;
    this.target = this.pack.randomTarget();
    this.crops = this.pack.roundCrops(this.target);
    this.roundStartedAt = Date.now();
    this.scheduleZoom();
    this.channel().emit('round:new', this.publicState());
    const t = this.target;
    console.log(
      `[${this.name}] Round ${this.roundNum} — cible (${t.gx}, ${t.gy})` +
      (t.interior ? ` [intérieur ${t.zone} mapID ${t.mapID}]` : t.zone ? ` [${t.zone}]` : '')
    );
    this.emitAdmin();
  }

  scheduleZoom() {
    const ms = this.config.zoomIntervalSec * 1000;
    if (this.level >= this.crops.length - 1) {
      this.nextZoomAt = null;
      return;
    }
    this.nextZoomAt = Date.now() + ms;
    this.zoomTimer = setTimeout(() => {
      this.level++;
      this.scheduleZoom();
      this.channel().emit('round:zoom', this.publicState());
    }, ms);
  }

  currentImage() {
    if (!this.crops.length) return null;
    return this.crops[this.level].buffer;
  }

  // Image pleine (dernier niveau de zoom) — réservée à l'admin (révéler la photo).
  fullImage() {
    if (!this.crops.length) return null;
    return this.crops[this.crops.length - 1].buffer;
  }

  // Position reçue d'un joueur (via socket ou via le pont émulateur).
  handlePos(playerName, mapID, x, y) {
    const player = this.findPlayerByName(playerName);
    if (!player) return;
    // mémorise la dernière position (pour le panneau admin / debug)
    player.lastPos = { mapID: Number(mapID), x: Number(x), y: Number(y) };
    this.emitAdmin();
    if (this.phase !== 'playing' || !this.target) return;
    const margin = this.config.marginTiles ?? this.pack.marginTiles;
    if (this.pack.checkWin(this.target, mapID, Number(x), Number(y), margin)) {
      this.win(player);
    }
  }

  // --- Mode admin : voir la cible + les positions en direct, passer la map. ---
  addAdmin(socket) {
    socket.join(`admin:${this.name}`);
    this.emitAdmin();
  }
  emitAdmin() {
    const t = this.target;
    this.io.to(`admin:${this.name}`).emit('admin', {
      target: t ? { gx: t.gx, gy: t.gy, zone: t.zone, interior: !!t.interior, mapID: t.mapID, file: t.file } : null,
      margin: this.config.marginTiles ?? this.pack.marginTiles,
      players: [...this.players.values()].map((p) => ({ name: p.name, pos: p.lastPos || null })),
    });
  }
  skipRound() {
    this.startRound();
  }

  win(player) {
    clearTimeout(this.zoomTimer);
    this.phase = 'intermission';
    player.score++;
    const elapsed = Math.round((Date.now() - this.roundStartedAt) / 1000);
    // Position de la cible relative au crop affiché, pour dessiner le marqueur côté client.
    // En mode photo, le joueur cible EST le centre de la capture -> marqueur au centre.
    let fx = 0.5, fy = 0.5;
    if (this.pack.mode !== 'photo') {
      const rect = this.crops[this.level].rect;
      const ts = this.pack.tileSize;
      fx = (this.target.gx * ts + ts / 2 - rect.x) / rect.w;
      fy = (this.target.gy * ts + ts / 2 - rect.y) / rect.h;
    }
    console.log(`[${this.name}] ${player.name} a trouvé en ${elapsed}s !`);
    this.channel().emit('round:won', {
      winner: player.name,
      elapsedSec: elapsed,
      marker: { fx, fy },
      ...this.publicState(),
    });
    setTimeout(() => {
      if (this.players.size > 0) this.startRound();
      else this.phase = 'waiting';
    }, this.config.intermissionSec * 1000);
  }

  publicState() {
    return {
      room: this.name,
      packName: this.pack.name,
      phase: this.phase,
      round: this.roundNum,
      level: this.level,
      maxLevel: this.pack.zoomLevels.length - 1,
      nextZoomAt: this.nextZoomAt,
      zoomIntervalSec: this.config.zoomIntervalSec,
      players: [...this.players.values()]
        .map((p) => ({ name: p.name, score: p.score, offline: !!p.offline }))
        .sort((a, b) => b.score - a.score),
    };
  }

  broadcastState() {
    this.channel().emit('state', this.publicState());
  }
}

module.exports = { Room };
