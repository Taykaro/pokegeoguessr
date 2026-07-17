// Message chaud/froid personnalisé selon le palier de proximité du joueur.
function hintMessage(name, tier) {
  switch (tier) {
    case 'lost':   return `Il est perdu ${name}, j'ai jamais vu un gars aussi perdu`;
    case 'region': return `${name}, ya de l'idée mais faut savoir lire une carte`;
    case 'warm':   return `${name} lui au moins, il sait lire une carte`;
    case 'goat':   return `${name.toUpperCase()} quel goat celui-là`;
    default:       return '';
  }
}

// Remplissage de la jauge (0-100 %) selon le palier et la distance en cartes.
// Bandes croissantes avec le rang de la ball (Poké < Super < Hyper < Master),
// pour que « plus la jauge est haute, meilleure est la ball ».
function hintPct(tier, m) {
  const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
  if (tier === 'goat')   return Math.round(lerp(100, 84, m / 2));         // Master
  if (tier === 'warm')   return Math.round(lerp(82, 62, (m - 2) / 3));    // Hyper
  if (tier === 'region') return Math.round(lerp(58, 30, (m - 5) / 25));   // Super
  return Math.round(lerp(26, 6, (m - 5) / 30));                           // Poké (lost)
}

// Un joueur hors-ligne depuis plus longtemps que ça est retiré de la room
// (sinon la liste des scores accumule des fantômes indéfiniment).
const STALE_OFFLINE_MS = 5 * 60 * 1000;
// Au-delà, on considère qu'un joueur n'est plus "en jeu" (émulateur arrêté,
// ROM pas chargée) : sert à l'affichage, pas au décompte des votes.
const IN_GAME_MS = 20 * 1000;

// Logique d'une partie : rounds, dézoom progressif, détection du gagnant.
class Room {
  constructor(io, name, pack, config, filter) {
    this.io = io;
    this.name = name;
    this.pack = pack;
    this.config = config;
    // Filtre de la room (choisi par son créateur) : région / type de lieu.
    this.filter = filter || { region: 'all', type: 'all' };
    // Difficulté : 'facile' (jauge live), 'moyen' (jauge au dézoom),
    // 'difficile' (aucune jauge chaud/froid).
    this.difficulty = (filter && filter.difficulty) || 'moyen';
    this.players = new Map(); // socketId -> { name, score }
    this.roundNum = 0;
    this.phase = 'waiting'; // waiting | playing | intermission
    this.target = null;
    this.level = 0;
    this.crops = [];
    this.zoomTimer = null;
    this.nextZoomAt = null;
    this.roundStartedAt = null;
    this.passVotes = new Set(); // noms (lowercase) des joueurs voulant passer ce round
    this.zoomVotes = new Set(); // noms voulant dézoomer tout de suite
    // Anti-répétition : évite de re-tirer les mêmes lieux à la suite.
    this.recentFiles = []; // derniers fichiers photo tirés
    this.recentZones = []; // dernières zones tirées
    // secret par room, distribué uniquement aux vrais admins — empêche de
    // récupérer l'image pleine (/img?full=1) en devinant juste l'URL.
    this.adminKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this.lastPresenceSig = '';
    this.startPresenceTicker();
  }

  // --- Présence ---
  // Source de vérité = le registre des sockets de Socket.IO, PAS le flag
  // `offline` : un socket mort sans 'disconnect' reçu (réseau coupé, onglet
  // tué, mise en veille) laissait un fantôme compté comme actif, ce qui
  // bloquait les votes (« 0/2 » alors qu'on est seul). On répare au passage.
  activePlayers() {
    const out = [];
    for (const [id, p] of this.players) {
      const connected = this.io.sockets.sockets.has(id);
      if (!connected && !p.offline) { p.offline = true; p.offlineSince = Date.now(); }
      if (!p.offline && connected) out.push(p);
    }
    return out;
  }

  // Retire les joueurs hors-ligne depuis trop longtemps (ils ne peuvent plus
  // récupérer leur score de toute façon).
  pruneStale() {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.players) {
      if (p.offline && now - (p.offlineSince || now) > STALE_OFFLINE_MS) { this.players.delete(id); changed = true; }
    }
    return changed;
  }

  // Ne compte que les votes de joueurs encore présents : un joueur qui vote
  // puis quitte ne doit plus peser dans le seuil.
  countVotes(voteSet) {
    const activeNames = new Set(this.activePlayers().map((p) => p.name.toLowerCase()));
    let n = 0;
    for (const v of voteSet) if (activeNames.has(v)) n++;
    return n;
  }

  // "En jeu" = son émulateur envoie encore des positions (ROM chargée, pas juste
  // un onglet ouvert). Sert à l'affichage, pas au décompte des votes.
  isInGame(p) {
    return !!p.lastPosAt && Date.now() - p.lastPosAt < IN_GAME_MS;
  }

  // Signature de l'état de présence : sert à ne rediffuser que si ça a bougé.
  // Inclut le statut "en jeu" pour que l'indicateur se rafraîchisse tout seul.
  presenceSignature() {
    return this.activePlayers()
      .map((p) => p.name + (this.isInGame(p) ? '+' : '-'))
      .sort().join('|') + '#' + this.players.size;
  }

  // Balayage régulier : détecte les sockets morts même sans événement, purge
  // les vieux fantômes et débloque les votes en attente.
  startPresenceTicker() {
    clearInterval(this.presenceTimer);
    this.presenceTimer = setInterval(() => {
      const pruned = this.pruneStale();
      const sig = this.presenceSignature();
      if (sig === this.lastPresenceSig && !pruned) return;
      this.lastPresenceSig = sig;
      this.broadcastState();
      this.checkPassThreshold();
      this.checkZoomThreshold();
    }, 5000);
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
    if (p) { p.offline = true; p.offlineSince = Date.now(); }
    this.broadcastState();
    this.checkPassThreshold(); // un joueur qui part peut débloquer les votes
    this.checkZoomThreshold();
  }

  // Abandon volontaire : retire complètement le joueur (contrairement à une
  // simple déconnexion réseau, qui garde sa place pour se reconnecter).
  leaveRoom(socketId) {
    this.players.delete(socketId);
    this.broadcastState();
    this.checkPassThreshold();
    this.checkZoomThreshold();
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
    this.passVotes = new Set();
    this.zoomVotes = new Set();
    this.target = this.pickTarget();
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
    this.startHintTicker();
  }

  // Tire une cible en évitant les répétitions récentes : jamais le même fichier
  // que les 10 derniers, ni la même zone que les 4 derniers rounds (sinon on
  // enchaîne des lieux qui se suivent). Repli sur un tirage libre si le filtre
  // est trop restreint pour éviter les répétitions.
  pickTarget() {
    let t;
    for (let tries = 0; tries < 20; tries++) {
      t = this.pack.randomTarget(this.filter);
      const repeat = this.recentFiles.includes(t.file) || this.recentZones.includes(t.zone);
      if (!repeat) break;
    }
    this.recentFiles.push(t.file);
    if (this.recentFiles.length > 10) this.recentFiles.shift();
    this.recentZones.push(t.zone);
    if (this.recentZones.length > 4) this.recentZones.shift();
    return t;
  }

  // Rafraîchit les jauges chaud/froid en direct (toutes les 2 s) tant qu'on
  // joue, pour qu'elles bougent quand les joueurs se déplacent (le dézoom est
  // trop espacé). N'émet que si les indices ont changé (léger event 'hints').
  startHintTicker() {
    clearInterval(this.hintTimer);
    if (this.difficulty !== 'facile') return; // live uniquement en Facile
    this.lastHintsJson = '';
    this.hintTimer = setInterval(() => {
      if (this.phase !== 'playing') return;
      const h = this.computeHints();
      const j = JSON.stringify(h);
      if (j === this.lastHintsJson) return;
      this.lastHintsJson = j;
      this.channel().emit('hints', h);
    }, 2000);
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
      this.zoomVotes = new Set(); // le dézoom repart -> on remet les votes à zéro
      this.scheduleZoom();
      this.channel().emit('round:zoom', this.publicState());
    }, ms);
  }

  // Dézoom immédiat (déclenché par vote unanime) : passe au niveau suivant et
  // relance le minuteur pour le niveau d'après.
  advanceZoom() {
    if (this.phase !== 'playing' || this.level >= this.crops.length - 1) return;
    clearTimeout(this.zoomTimer);
    this.level++;
    this.zoomVotes = new Set();
    this.scheduleZoom();
    this.channel().emit('round:zoom', this.publicState());
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
    // mémorise la dernière position (pour le panneau admin / debug) et l'instant
    // du dernier signe de vie de son émulateur (= "en jeu")
    player.lastPos = { mapID: Number(mapID), x: Number(x), y: Number(y) };
    player.lastPosAt = Date.now();
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

  // --- Vote "passer" : il faut que TOUS les joueurs connectés (non hors-ligne)
  // demandent à passer pour changer de round. ---
  requestPass(playerName) {
    if (this.phase !== 'playing') return;
    const player = this.findPlayerByName(playerName);
    if (!player || player.offline) return;
    this.passVotes.add(player.name.toLowerCase());
    this.broadcastState();
    this.checkPassThreshold();
  }

  checkPassThreshold() {
    if (this.phase !== 'playing') return;
    const active = this.activePlayers();
    const votes = this.countVotes(this.passVotes);
    if (active.length > 0 && votes >= active.length) {
      console.log(`[${this.name}] vote unanime pour passer (${votes}/${active.length})`);
      this.startRound();
    }
  }

  // --- Vote "zoom suivant" : dézoome tout de suite quand TOUS les joueurs
  // connectés le demandent (raccourci le minuteur). ---
  requestZoom(playerName) {
    if (this.phase !== 'playing' || this.level >= this.crops.length - 1) return;
    const player = this.findPlayerByName(playerName);
    if (!player || player.offline) return;
    this.zoomVotes.add(player.name.toLowerCase());
    this.broadcastState();
    this.checkZoomThreshold();
  }

  checkZoomThreshold() {
    if (this.phase !== 'playing') return;
    const active = this.activePlayers();
    const votes = this.countVotes(this.zoomVotes);
    if (active.length > 0 && votes >= active.length) {
      console.log(`[${this.name}] vote unanime pour dézoomer (${votes}/${active.length})`);
      this.advanceZoom();
    }
  }

  // Position monde (coords RAM) d'un joueur : overworld -> ses coords ; dans un
  // bâtiment connu -> la porte du bâtiment (via pack.playerWorldPos). null sinon.
  worldPosOf(player) {
    const p = player.lastPos;
    if (!p) return null;
    return this.pack.playerWorldPos(p.mapID, p.x, p.y);
  }

  // Données pour la révélation de fin de round : position monde (coords RAM) de
  // la cible + de chaque joueur. Le client les place sur le Town Map via l'affine
  // (townmap.affine) si dispo, sinon sur la minimap 1:1 (repli).
  buildReveal(winnerName) {
    const tpos = this.pack.targetWorldPos ? this.pack.targetWorldPos(this.target) : null;
    const players = [];
    for (const p of this.players.values()) {
      const wp = this.worldPosOf(p);
      if (wp) players.push({ name: p.name, gx: wp.gx, gy: wp.gy, won: p.name === winnerName });
    }
    const tm = this.pack.townmap;
    return {
      // dims de la carte de fond utilisée par le client
      w: tm ? tm.w : (this.pack.minimapW || 0),
      h: tm ? tm.h : (this.pack.minimapH || 0),
      // affine coords RAM -> pixels Town Map (absent => minimap 1:1)
      townmap: tm ? { ax: tm.ax, bx: tm.bx, cx: tm.cx, ay: tm.ay, by: tm.by, cy: tm.cy } : null,
      target: tpos ? { gx: tpos.gx, gy: tpos.gy } : null,
      interior: !!this.target.interior,
      zone: this.target.zone || null,
      players,
    };
  }

  win(player) {
    clearTimeout(this.zoomTimer);
    clearInterval(this.hintTimer);
    this.phase = 'intermission';
    // Score au temps : trouvé tôt (photo encore très zoomée) = plus de points.
    // 4 niveaux de zoom -> 4,3,2,1 points selon le niveau atteint.
    const pts = Math.max(1, this.crops.length - this.level);
    player.score += pts;
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
    // Fin de partie : premier à winScore points (0 = pas de limite).
    const winScore = this.config.winScore || 0;
    const gameOver = winScore > 0 && player.score >= winScore;
    console.log(`[${this.name}] ${player.name} a trouvé en ${elapsed}s (+${pts} pts)${gameOver ? ' — PARTIE GAGNÉE' : ''} !`);
    this.channel().emit('round:won', {
      winner: player.name,
      elapsedSec: elapsed,
      points: pts,
      gameOver,
      marker: { fx, fy },
      reveal: this.buildReveal(player.name),
      ...this.publicState(),
    });
    setTimeout(() => {
      if (gameOver) this.endGame(player.name);
      else if (this.players.size > 0) this.startRound();
      else this.phase = 'waiting';
    }, this.config.intermissionSec * 1000);
  }

  // Podium de fin de partie, puis remise à zéro et nouvelle partie.
  endGame(winnerName) {
    clearTimeout(this.zoomTimer);
    clearInterval(this.hintTimer);
    this.phase = 'gameover';
    const standings = [...this.players.values()]
      .map((p) => ({ name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
    this.channel().emit('game:over', {
      winner: winnerName, winScore: this.config.winScore,
      seconds: this.config.podiumSec || 12, standings,
    });
    setTimeout(() => {
      for (const p of this.players.values()) p.score = 0;
      this.roundNum = 0;
      if (this.players.size > 0) this.startRound();
      else this.phase = 'waiting';
    }, (this.config.podiumSec || 12) * 1000);
  }

  // Indices chaud/froid par joueur (pour le tableau affiché à chaque dézoom).
  // Uniquement quand on joue et que la position du joueur est calculable.
  computeHints() {
    // En Difficile, aucune jauge chaud/froid n'est fournie.
    if (this.phase !== 'playing' || !this.target || this.difficulty === 'difficile') return [];
    const out = [];
    for (const p of this.players.values()) {
      if (p.offline || !p.lastPos) continue;
      const h = this.pack.proximityHint(this.target, p.lastPos.mapID, p.lastPos.x, p.lastPos.y);
      if (!h) continue;
      out.push({
        name: p.name,
        tier: h.tier,
        pct: hintPct(h.tier, h.mapsAway),
        message: hintMessage(p.name, h.tier),
      });
    }
    return out;
  }

  publicState() {
    return {
      room: this.name,
      packName: this.pack.name,
      phase: this.phase,
      round: this.roundNum,
      level: this.level,
      maxLevel: this.pack.zoomLevels.length - 1,
      // Temps restant RELATIF (secondes) : le client décompte lui-même. Un
      // timestamp absolu dépendait de l'accord des horloges client/serveur —
      // le moindre décalage donnait des chronos aberrants (vu : « 481:19 »).
      zoomInSec: this.nextZoomAt ? Math.max(0, Math.round((this.nextZoomAt - Date.now()) / 1000)) : null,
      // conservé pour les anciens clients déjà distribués (exe) qui l'utilisent
      nextZoomAt: this.nextZoomAt,
      zoomIntervalSec: this.config.zoomIntervalSec,
      passVotes: this.countVotes(this.passVotes),
      passNeeded: this.activePlayers().length,
      zoomVotes: this.countVotes(this.zoomVotes),
      atMaxZoom: this.level >= this.pack.zoomLevels.length - 1,
      winScore: this.config.winScore || 0,
      difficulty: this.difficulty,
      hints: this.computeHints(),
      players: [...this.players.entries()]
        .map(([id, p]) => ({
          name: p.name,
          score: p.score,
          offline: !!p.offline || !this.io.sockets.sockets.has(id),
          inGame: this.isInGame(p),
        }))
        .sort((a, b) => b.score - a.score),
    };
  }

  broadcastState() {
    this.channel().emit('state', this.publicState());
  }
}

module.exports = { Room };
