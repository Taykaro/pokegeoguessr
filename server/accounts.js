// Comptes joueurs (MVP) : pseudo + mot de passe. Mot de passe HACHÉ (scrypt +
// sel), jamais en clair. Jeton d'auth sans état (HMAC) : survit aux redémarrages.
// Stockage fichier data/accounts.json : sur le NAS, data/ est un volume Docker
// conservé entre déploiements et sauvegardé chaque nuit.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FILE = path.join(__dirname, '..', 'data', 'accounts.json');

let DB = { secret: null, users: {} };
try { Object.assign(DB, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch {}
if (!DB.secret) DB.secret = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

let dirty = true;
function save() { if (!dirty) return; dirty = false; try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(DB)); } catch {} }
save();
const iv = setInterval(save, 15000); if (iv.unref) iv.unref();

const normNick = (s) => String(s || '').trim();
const keyOf = (s) => normNick(s).toLowerCase();
const hashPass = (pass, salt) => crypto.scryptSync(String(pass), salt, 64).toString('hex');
function tokenFor(k) { const sig = crypto.createHmac('sha256', DB.secret).update(k).digest('hex').slice(0, 32); return k + '.' + sig; }
function verifyToken(tok) {
  if (!tok || typeof tok !== 'string') return null;
  const i = tok.lastIndexOf('.'); if (i < 0) return null;
  const k = tok.slice(0, i), sig = tok.slice(i + 1);
  const exp = crypto.createHmac('sha256', DB.secret).update(k).digest('hex').slice(0, 32);
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  return DB.users[k] ? k : null;
}
const pub = (u) => ({ nick: u.nick, stats: u.stats });

function register(nick, pass) {
  nick = normNick(nick); const k = keyOf(nick);
  if (nick.length < 2 || nick.length > 20) return { error: 'Pseudo : 2 à 20 caractères' };
  if (String(pass || '').length < 4) return { error: 'Mot de passe : 4 caractères minimum' };
  if (DB.users[k]) return { error: 'Ce pseudo est déjà pris' };
  const salt = crypto.randomBytes(16).toString('hex');
  DB.users[k] = { nick, salt, hash: hashPass(pass, salt), created: Date.now(), stats: { games: 0, wins: 0, points: 0, best: 0, found: 0 } };
  dirty = true; save();
  return { ok: true, nick, token: tokenFor(k), stats: DB.users[k].stats };
}
function login(nick, pass) {
  const k = keyOf(nick); const u = DB.users[k];
  if (!u) return { error: 'Pseudo inconnu' };
  const h = hashPass(pass, u.salt);
  if (h.length !== u.hash.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash))) return { error: 'Mot de passe incorrect' };
  return { ok: true, nick: u.nick, token: tokenFor(k), stats: u.stats };
}
function me(token) { const k = verifyToken(token); return k ? pub(DB.users[k]) : null; }
const isRegistered = (s) => !!DB.users[keyOf(s)];

function recordFound(k) { const u = DB.users[k]; if (u) { u.stats.found++; dirty = true; } }
function recordGame(k, { won, score }) {
  const u = DB.users[k]; if (!u) return;
  u.stats.games++; if (won) u.stats.wins++;
  u.stats.points += (score || 0); if ((score || 0) > u.stats.best) u.stats.best = score || 0;
  dirty = true; save();
}

module.exports = { register, login, me, verifyToken, isRegistered, recordFound, recordGame };
