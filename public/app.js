// Interface de l'application de bureau (fenêtre unique).
// Rejoint automatiquement en solo + admin, affiche l'objectif + les infos admin.
const socket = io();
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const myName = params.get('name') || 'Solo';
const room = params.get('room') || 'main';
const isAdmin = params.get('admin') === '1';
const filter = { region: params.get('region') || 'all', type: params.get('type') || 'all', difficulty: params.get('difficulty') || 'moyen' };
let state = null;
let cd = null;
let adminKey = null;
let myVoted = false;

// Solo / Multi : on masque tout ce qui révèle la réponse ou triche.
if (!isAdmin) document.querySelectorAll('.admin-only').forEach((e) => (e.hidden = true));

socket.emit('join', { name: myName, room, admin: isAdmin, filter }, (res) => {
  if (res && res.ok) { adminKey = res.adminKey || null; apply(res.state); }
});

// --- Sons (synthèse WebAudio, aucun asset externe) ---
let muted = localStorage.getItem('pg_muted') === '1';
let actx = null;
function ac() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; }
function tone(freq, start, dur, gain = 0.14, type = 'sine') {
  const c = ac(), o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  const t0 = c.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
function melody(notes) { if (muted) return; try { let t = 0; for (const [f, d, g] of notes) { tone(f, t, d, g); t += d * 0.85; } } catch {} }
const SND = {
  zoom: () => melody([[520, 0.08, 0.06]]),
  goat: () => melody([[660, 0.1], [880, 0.12], [1175, 0.16]]),   // arpège montant joyeux
  warm: () => melody([[590, 0.1], [740, 0.12]]),
  region: () => melody([[440, 0.14]]),
  lost: () => melody([[300, 0.14], [230, 0.16]]),                 // descendant "raté"
  win: () => melody([[784, 0.12], [988, 0.12], [1319, 0.2], [1568, 0.28]]),
  gameover: () => melody([[523, 0.14], [659, 0.14], [784, 0.14], [1047, 0.18], [784, 0.12], [1047, 0.4]]),
};
function updateMute() { $('mute').textContent = muted ? '🔇' : '🔊'; }
updateMute();
$('mute').onclick = () => { muted = !muted; localStorage.setItem('pg_muted', muted ? '1' : '0'); updateMute(); if (!muted) SND.zoom(); };
// débloque l'audio au 1er clic (politique navigateur)
document.addEventListener('click', () => { try { ac(); } catch {} }, { once: true });

function apply(s) {
  state = s;
  $('round').textContent = s.round;
  $('zoom').textContent = s.level + 1;
  $('scores-v').textContent = (s.players || []).map((p) => `${p.name} ${p.score}`).join(' · ') || '–';
  const diffLabel = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile' }[s.difficulty] || '';
  const parts = [s.winScore ? `premier à ${s.winScore}` : '', diffLabel].filter(Boolean);
  $('goal').textContent = parts.length ? `(${parts.join(' · ')})` : '';
  const need = s.passNeeded ?? 0, got = s.passVotes ?? 0;
  const pv = $('passvote');
  pv.textContent = myVoted ? `✅ En attente (${got}/${need})` : `🙋 Demander à passer (${got}/${need})`;
  pv.disabled = myVoted || s.phase !== 'playing';
  hints(s);
  img();
  countdown();
}
// Jauge chaud/froid par joueur : une ball (Poké < Super < Hyper < Master) +
// une barre de proximité animée. Plus le joueur est proche, plus la ball monte.
const BALL = { lost: 'Poké Ball', region: 'Super Ball', warm: 'Hyper Ball', goat: 'Master Ball' };
function ballSVG(tier) {
  const top = { lost: '#ee1515', region: '#2a75bb', warm: '#feca1b', goat: '#7b3ff2' }[tier] || '#ee1515';
  let deco = '';
  if (tier === 'region') deco = '<path d="M16,34 L50,46 L84,34" fill="none" stroke="#ee1515" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>';
  else if (tier === 'warm') deco = '<rect x="28" y="8" width="9" height="38" rx="2" fill="#222"/><rect x="63" y="8" width="9" height="38" rx="2" fill="#222"/>';
  else if (tier === 'goat') deco = '<circle cx="33" cy="22" r="4.5" fill="#ff6ec7"/><circle cx="67" cy="22" r="4.5" fill="#ff6ec7"/><text x="50" y="42" text-anchor="middle" font-family="system-ui" font-size="26" font-weight="900" fill="#ff6ec7">M</text>';
  return `<svg viewBox="0 0 100 100" width="34" height="34">`
    + `<circle cx="50" cy="50" r="46" fill="#f6f6f6" stroke="#141414" stroke-width="5"/>`
    + `<path d="M4,50 A46,46 0 0 1 96,50 Z" fill="${top}" stroke="#141414" stroke-width="5"/>`
    + deco
    + `<rect x="5" y="45.5" width="90" height="9" fill="#141414"/>`
    + `<circle cx="50" cy="50" r="15" fill="#f6f6f6" stroke="#141414" stroke-width="5"/>`
    + `<circle cx="50" cy="50" r="6.5" fill="#fff" stroke="#141414" stroke-width="3"/></svg>`;
}
function hints(s) {
  const box = $('hints');
  const list = (s.phase === 'playing' && s.hints) ? s.hints : [];
  const existing = {};
  for (const el of [...box.children]) existing[el.dataset.name] = el;
  const seen = new Set();
  for (const h of list) {
    seen.add(h.name);
    let pill = existing[h.name];
    let isNew = false;
    if (!pill) {
      isNew = true;
      pill = document.createElement('div');
      pill.dataset.name = h.name;
      pill.innerHTML = '<div class="pill-ball"></div><div class="pill-body">'
        + '<div class="pill-top"><span class="pill-name"></span><span class="pill-tier"></span></div>'
        + '<div class="pill-track"><div class="pill-fill"></div></div>'
        + '<div class="pill-msg"></div></div>';
      box.appendChild(pill);
    }
    pill.className = 'pill ' + h.tier;
    pill.querySelector('.pill-ball').innerHTML = ballSVG(h.tier);
    pill.querySelector('.pill-name').textContent = h.name;
    pill.querySelector('.pill-tier').textContent = BALL[h.tier] || '';
    pill.querySelector('.pill-msg').textContent = h.message;
    const fill = pill.querySelector('.pill-fill');
    // reflow avant de fixer la largeur -> la barre s'anime depuis 0 (nouvelle pill)
    // ou depuis sa valeur précédente (transition CSS). Ne dépend pas de rAF.
    if (isNew) void fill.offsetWidth;
    fill.style.width = (h.pct || 0) + '%';
  }
  for (const el of [...box.children]) if (!seen.has(el.dataset.name)) el.remove();
}
function img() { $('photo').src = `/img/${room}?t=${Date.now()}`; }
function countdown() {
  clearInterval(cd);
  const el = $('countdown');
  if (!state || !state.nextZoomAt) { el.textContent = 'zoom max'; return; }
  const t = () => {
    const s = Math.max(0, Math.round((state.nextZoomAt - Date.now()) / 1000));
    el.textContent = `dézoom ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  t(); cd = setInterval(t, 1000);
}

$('skip').onclick = () => socket.emit('admin:skip');
$('reveal').onclick = () => { $('photo').src = `/img/${room}?full=1&key=${adminKey}&t=${Date.now()}`; };
$('passvote').onclick = () => { myVoted = true; socket.emit('pass:request'); if (state) apply(state); };
$('abandon').onclick = () => {
  socket.emit('leave');
  if (window.pokegeo && window.pokegeo.goToMenu) window.pokegeo.goToMenu();
  else location.reload();
};

// Repère mon propre palier chaud/froid dans l'état courant.
function myTier(s) { const h = (s.hints || []).find((x) => x.name === myName); return h && h.tier; }

// Rafraîchissement live des jauges chaud/froid (toutes les 2 s côté serveur).
socket.on('hints', (arr) => {
  if (!state || state.phase !== 'playing') return;
  state.hints = arr;
  hints(state);
});

socket.on('state', apply);
socket.on('round:new', (s) => {
  $('banner').hidden = true; $('revealCanvas').hidden = true;
  $('podium').hidden = true; clearInterval(podiumCd);
  myVoted = false; apply(s);
});

// Podium de fin de partie (premier à N points).
let podiumCd = null;
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
socket.on('game:over', (d) => {
  SND.gameover();
  const p = $('podium');
  p.querySelector('.podium-title').innerHTML = `Victoire de <b>${esc(d.winner)}</b> !`;
  const medals = ['🥇', '🥈', '🥉'];
  p.querySelector('.podium-list').innerHTML = (d.standings || [])
    .map((s, i) => `<li class="${i === 0 ? 'p1' : ''}"><span>${medals[i] || (i + 1) + '.'} ${esc(s.name)}</span><b>${s.score}</b></li>`)
    .join('');
  const sub = p.querySelector('.podium-sub');
  let sec = d.seconds || 12;
  clearInterval(podiumCd);
  const tick = () => { sub.textContent = `Nouvelle partie dans ${Math.max(0, sec)}s…`; if (sec-- <= 0) clearInterval(podiumCd); };
  tick(); podiumCd = setInterval(tick, 1000);
  p.hidden = false;
});
socket.on('round:zoom', (s) => {
  const t = myTier(s);
  if (t && SND[t]) SND[t](); else SND.zoom();
  apply(s);
});
socket.on('round:won', (d) => {
  apply(d);
  SND.win();
  const b = $('banner');
  const pts = d.points ? ` +${d.points} pt${d.points > 1 ? 's' : ''}` : '';
  b.textContent = `🎉 ${d.winner}${pts} en ${d.elapsedSec}s`;
  b.hidden = false;
  drawReveal(d.reveal);
});

// Révélation de fin de round : minimap du monde + position de la cible et des joueurs.
function drawReveal(reveal) {
  const cv = $('revealCanvas');
  if (!reveal || !reveal.w || !reveal.target) { cv.hidden = true; return; }
  const wrap = $('photo-wrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  cv.width = W; cv.height = H; cv.hidden = false;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, W, H);
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(W / reveal.w, H / reveal.h);
    const dw = reveal.w * scale, dh = reveal.h * scale;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.55; ctx.drawImage(img, ox, oy, dw, dh); ctx.globalAlpha = 1;
    const P = (gx, gy) => [ox + gx * scale, oy + gy * scale];
    // cible = croix + anneau rouge
    const [tx, ty] = P(reveal.target.gx, reveal.target.gy);
    ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tx, ty, 9, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx - 13, ty); ctx.lineTo(tx + 13, ty); ctx.moveTo(tx, ty - 13); ctx.lineTo(tx, ty + 13); ctx.stroke();
    ctx.fillStyle = '#ff8a8a'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
    ctx.fillText((reveal.interior ? '🚪 ' : '') + (reveal.zone || 'cible'), tx, ty + 22);
    // joueurs
    for (const pl of reveal.players) {
      const [px, py] = P(pl.gx, pl.gy);
      ctx.fillStyle = pl.won ? '#ffd54a' : '#4c9ef0';
      ctx.beginPath(); ctx.arc(px, py, pl.won ? 6 : 5, 0, 7); ctx.fill();
      ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#e8ebf0'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(pl.name, px, py - 9);
    }
  };
  img.src = '/minimap';
}
socket.on('admin', (d) => {
  const t = d.target;
  $('target').textContent = t
    ? (t.interior ? `${t.zone} [int] map ${t.mapID} — (${t.gx}, ${t.gy})` : `${t.zone} — (${t.gx}, ${t.gy})`)
    : '–';
  const me = (d.players || []).find((p) => p.name === myName);
  const p = me && me.pos;
  $('pos').textContent = p ? `map ${p.mapID} — (${p.x}, ${p.y})` : '– (charge ta save dans BizHawk)';
  if (t && p) {
    const dx = Math.abs(p.x - t.gx), dy = Math.abs(p.y - t.gy);
    const okMap = !t.interior || Number(p.mapID) === t.mapID;
    const near = okMap && dx <= d.margin && dy <= d.margin;
    $('dist').textContent = `Δ (${dx}, ${dy}) ${okMap ? '' : '· mauvaise carte'} ${near ? '✅ GAGNÉ' : ''}`;
  } else { $('dist').textContent = '–'; }
});
