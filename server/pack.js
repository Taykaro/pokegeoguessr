const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

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

    if (this.mode === 'photo') {
      // Pack "photo" : chaque round = une vraie capture du jeu (écran du haut),
      // montrée à des fenêtres de zoom croissantes. Pas de grande carte.
      this.photos = cfg.photos || [];
      this.widthTiles = 0;
      this.heightTiles = 0;
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

  randomTarget() {
    if (this.mode === 'photo') {
      const p = this.photos[Math.floor(Math.random() * this.photos.length)];
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
}

function loadPack(dir) {
  return new GamePack(dir);
}

module.exports = { loadPack };
