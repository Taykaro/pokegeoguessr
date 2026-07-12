// Interface de l'application de bureau (fenêtre unique).
// Rejoint automatiquement en solo + admin, affiche l'objectif + les infos admin.
const socket = io();
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const myName = params.get('name') || 'Solo';
const room = params.get('room') || 'main';
const isAdmin = params.get('admin') === '1';
const filter = { region: params.get('region') || 'all', type: params.get('type') || 'all' };
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
  const need = s.passNeeded ?? 0, got = s.passVotes ?? 0;
  const pv = $('passvote');
  pv.textContent = myVoted ? `✅ En attente (${got}/${need})` : `🙋 Demander à passer (${got}/${need})`;
  pv.disabled = myVoted || s.phase !== 'playing';
  hints(s);
  img();
  countdown();
}
// Tableau chaud/froid : une ligne par joueur avec une position connue.
const HINT_EMOJI = { lost: '🥶', region: '🧭', warm: '🔥', goat: '🐐' };
function hints(s) {
  const box = $('hints');
  const list = (s.phase === 'playing' && s.hints) ? s.hints : [];
  box.innerHTML = list
    .map((h) => {
      const emoji = HINT_EMOJI[h.tier] || '';
      const text = h.message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      return `<div class="hint ${h.tier}">${emoji} ${text}</div>`;
    })
    .join('');
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

socket.on('state', apply);
socket.on('round:new', (s) => { $('banner').hidden = true; $('reveal').hidden = true; myVoted = false; apply(s); });
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
  const cv = $('reveal');
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
