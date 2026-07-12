const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// --- Géographie du monde HGSS (pour l'indice chaud/froid) ---
// Les coords extérieures gx/gy sont des tuiles globales sur la matrice monde.
// 1 "carte" (chunk de la matrice) = 32 tuiles.
const CHUNK_TILES = 32;
// Frontière Johto / Kanto sur l'axe X global : Johto ≈ gx 256-830,
// Kanto ≈ gx 896-1438 ; la transition (Mont Argenté / Tohjo) est vers gx 865.
const REGION_BOUNDARY_GX = 865;
// Bornes plausibles d'une position overworld (photos ext. : gx 64-1438,
// gy 60-536, avec marge). Hors de ça = coords locales d'intérieur -> pas d'indice.
const WORLD_MIN_X = 30, WORLD_MAX_X = 1500, WORLD_MIN_Y = 30, WORLD_MAX_Y = 600;

// Un "game pack" = un dossier avec pack.json + map.png.
// pack.json décrit la correspondance (mapID, x, y locaux) -> tuile globale,
// les zones jouables où tirer des cibles, et les niveaux de zoom.
class GamePack {
  constructor(dir) {
    this.dir = dir;
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
    this.name = cfg.name || path.basename(dir);
    this.tileSize = cfg.tileSize || 16;
    this.zoomLevels = cfg.zoomLevels || [64, 128, 256, 512, 1024];
    this.marginTiles = cfg.marginTiles || 3;
    this.simFullMap = !!cfg.simFullMap;
    this.maps = cfg.maps || {};
    this.playable = cfg.playable || [];
    this.mode = cfg.mode || 'map';
    // Porte overworld (coords RAM globales) de chaque intérieur, pour l'indice
    // chaud/froid : mapID -> { gx, gy }. Construit par tools/build-interior-doors.js.
    this.interiorDoors = cfg.interiorDoors || {};

    if (this.mode === 'photo') {
      // Pack "photo" : chaque round = une vraie capture du jeu (écran du haut),
      // montrée à des fenêtres de zoom croissantes. Pas de grande carte.
      this.photos = cfg.photos || [];
      this.widthTiles = 0;
      this.heightTiles = 0;
      // minimap.png : silhouette du monde en espace RAM 1:1 (1 px = 1 tuile),
      // pour la révélation de fin de round (positions des joueurs + cible).
      const mm = path.join(dir, 'minimap.png');
      if (fs.existsSync(mm)) {
        this.minimapPng = fs.readFileSync(mm);
        const d = PNG.sync.read(this.minimapPng);
        this.minimapW = d.width; this.minimapH = d.height;
      } else { this.minimapPng = null; this.minimapW = 0; this.minimapH = 0; }
      this._photoCache = new Map();
      return;
    }

    const mapPath = path.join(dir, 'map.png');
    if (!fs.existsSync(mapPath)) {
      throw new Error(
        `map.png manquant dans ${dir}. Pour le pack de test, lance d'abord: npm run genmap`
      );
    }
    this.map = PNG.sync.read(fs.readFileSync(mapPath));
    this.widthTiles = Math.floor(this.map.width / this.tileSize);
    this.heightTiles = Math.floor(this.map.height / this.tileSize);
  }

  // Coordonnées jeu -> tuile globale sur la grande carte. null si map inconnue (intérieur, etc.)
  toGlobal(mapID, x, y) {
    const m = this.maps[String(mapID)];
    if (!m) return null;
    return { gx: m.offsetX + x, gy: m.offsetY + y };
  }

  // Région d'une photo (extérieur : sa position ; intérieur : sa porte).
  // null si intérieur sans porte connue (région indéterminable).
  photoRegion(p) {
    if (!p.interior) return this.regionOf(p.gx);
    const d = this.interiorDoors[String(p.mapID)];
    return d ? this.regionOf(d.gx) : null;
  }

  // Sous-ensemble de photos selon un filtre { region, type } (avec cache).
  //  region : 'all' | 'johto' | 'kanto'   type : 'all' | 'ext' | 'int'
  // Si le filtre ne laisse rien, on retombe sur toutes les photos.
  filteredPhotos(filter) {
    const region = (filter && filter.region) || 'all';
    const type = (filter && filter.type) || 'all';
    const key = region + '|' + type;
    if (this._photoCache.has(key)) return this._photoCache.get(key);
    let pool = this.photos.filter((p) => {
      if (type === 'ext' && p.interior) return false;
      if (type === 'int' && !p.interior) return false;
      if (region !== 'all' && this.photoRegion(p) !== region) return false;
      return true;
    });
    if (!pool.length) pool = this.photos;
    this._photoCache.set(key, pool);
    return pool;
  }

  randomTarget(filter) {
    if (this.mode === 'photo') {
      const pool = this.filteredPhotos(filter);
      const p = pool[Math.floor(Math.random() * pool.length)];
      return { gx: p.gx, gy: p.gy, file: p.file, zone: p.zone, interior: !!p.interior, mapID: p.mapID };
    }
    let rects = this.playable;
    if (!rects.length) rects = [{ x: 0, y: 0, w: this.widthTiles, h: this.heightTiles }];
    const total = rects.reduce((s, r) => s + r.w * r.h, 0);
    let pick = Math.random() * total;
    let rect = rects[rects.length - 1];
    for (const r of rects) {
      pick -= r.w * r.h;
      if (pick <= 0) { rect = r; break; }
    }
    return {
      gx: rect.x + Math.floor(Math.random() * rect.w),
      gy: rect.y + Math.floor(Math.random() * rect.h),
    };
  }

  // Crop carré de windowPx pixels centré sur la tuile (gx, gy), clampé aux bords.
  // Retourne { buffer (PNG), rect: {x, y, w, h} en pixels sur la grande carte }.
  crop(gx, gy, windowPx) {
    const cx = gx * this.tileSize + Math.floor(this.tileSize / 2);
    const cy = gy * this.tileSize + Math.floor(this.tileSize / 2);
    const w = Math.min(windowPx, this.map.width);
    const h = Math.min(windowPx, this.map.height);
    let x = Math.max(0, Math.min(cx - Math.floor(w / 2), this.map.width - w));
    let y = Math.max(0, Math.min(cy - Math.floor(h / 2), this.map.height - h));
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(this.map, out, x, y, w, h, 0, 0);
    return { buffer: PNG.sync.write(out), rect: { x, y, w, h } };
  }

  // Vrai si la position du joueur (mapID, x, y) gagne le round sur `target`.
  //  - photo extérieur : coords RAM déjà globales et uniques -> compare x,y (mapID ignoré).
  //  - photo intérieur : coords LOCALES non uniques -> exige mapID == target.mapID ET x,y.
  //  - mode carte       : passe par toGlobal(mapID).
  checkWin(target, mapID, x, y, margin) {
    x = Number(x); y = Number(y);
    if (this.mode === 'photo') {
      if (target.interior && Number(mapID) !== target.mapID) return false;
      return Math.abs(x - target.gx) <= margin && Math.abs(y - target.gy) <= margin;
    }
    const pos = this.toGlobal(mapID, x, y);
    if (!pos) return false;
    return Math.abs(pos.gx - target.gx) <= margin && Math.abs(pos.gy - target.gy) <= margin;
  }

  // Région (johto/kanto) d'une tuile globale X.
  regionOf(gx) {
    return gx < REGION_BOUNDARY_GX ? 'johto' : 'kanto';
  }

  // Position monde (coords RAM globales) d'une cible : directe pour un extérieur,
  // sinon la porte overworld de l'intérieur. null si intérieur sans porte connue.
  targetWorldPos(target) {
    if (!target.interior) return { gx: target.gx, gy: target.gy };
    const door = this.interiorDoors[String(target.mapID)];
    return door ? { gx: door.gx, gy: door.gy } : null;
  }

  // Position monde (coords RAM globales) d'un JOUEUR. Symétrique de la cible :
  // s'il est dans un intérieur connu (mapID présent dans interiorDoors), on le
  // rattache à la PORTE overworld de ce bâtiment (coord extérieure la plus
  // proche) — sinon ses coords locales seraient prises à tort pour des coords
  // monde et donneraient un « perdu » aberrant. En overworld, ses coords sont
  // déjà globales. null si non localisable (intérieur sans porte, coords hors monde).
  playerWorldPos(mapID, x, y) {
    const door = this.interiorDoors[String(mapID)];
    if (door) return { gx: door.gx, gy: door.gy };
    x = Number(x); y = Number(y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < WORLD_MIN_X || x > WORLD_MAX_X || y < WORLD_MIN_Y || y > WORLD_MAX_Y) return null;
    return { gx: x, gy: y };
  }

  // Indice chaud/froid : à quelle distance (en "cartes") le joueur est de la
  // cible, et dans quel palier. Pour un intérieur, la distance est mesurée
  // jusqu'à sa PORTE overworld (le joueur chasse en extérieur vers l'entrée).
  // Renvoie null si non calculable :
  //  - intérieur sans porte connue (12 cas : cartes atteintes par événement) ;
  //  - position joueur hors matrice monde (il est lui-même dans un bâtiment).
  // Palier : 'goat' (≤2 cartes) | 'warm' (≤5) | 'region' (bonne région, loin)
  //          | 'lost' (mauvaise région).
  proximityHint(target, mapID, x, y) {
    if (this.mode !== 'photo' || !target) return null;
    const tpos = this.targetWorldPos(target);
    if (!tpos) return null;
    const ppos = this.playerWorldPos(mapID, x, y);
    if (!ppos) return null;
    const dx = Math.abs(ppos.gx - tpos.gx), dy = Math.abs(ppos.gy - tpos.gy);
    const mapsAway = Math.max(dx, dy) / CHUNK_TILES;
    let tier;
    if (mapsAway <= 2) tier = 'goat';
    else if (mapsAway <= 5) tier = 'warm';
    else if (this.regionOf(ppos.gx) === this.regionOf(tpos.gx)) tier = 'region';
    else tier = 'lost';
    return { tier, mapsAway };
  }

  // Les images de zoom d'un round, quel que soit le mode.
  //  - mode carte  : crops de map.png autour de la tuile cible.
  //  - mode photo  : crops (zoom) de la vraie capture, centrés, ratio 4:3.
  roundCrops(target) {
    if (this.mode === 'photo') {
      const img = PNG.sync.read(fs.readFileSync(path.join(this.dir, target.file)));
      return this.zoomLevels.map((win) => {
        const w = Math.min(win, img.width);
        const h = Math.min(Math.round(win * 0.75), img.height);
        const x = Math.max(0, Math.min(Math.round(img.width / 2 - w / 2), img.width - w));
        const y = Math.max(0, Math.min(Math.round(img.height / 2 - h / 2), img.height - h));
        const out = new PNG({ width: w, height: h });
        PNG.bitblt(img, out, x, y, w, h, 0, 0);
        return { buffer: PNG.sync.write(out), rect: { x, y, w, h } };
      });
    }
    return this.zoomLevels.map((px) => this.crop(target.gx, target.gy, px));
  }

  fullMapBuffer() {
    return PNG.sync.write(this.map);
  }

  minimapBuffer() {
    return this.minimapPng;
  }
}

function loadPack(dir) {
  return new GamePack(dir);
}

module.exports = { loadPack };
