// Interface de l'application de bureau (fenêtre unique).
// Rejoint automatiquement en solo + admin, affiche l'objectif + les infos admin.
const socket = io();
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const myName = params.get('name') || 'Solo';
const room = params.get('room') || 'main';
const isAdmin = params.get('admin') === '1';
let state = null;
let cd = null;
let adminKey = null;
let myVoted = false;

// Solo / Multi : on masque tout ce qui révèle la réponse ou triche.
if (!isAdmin) document.querySelectorAll('.admin-only').forEach((e) => (e.hidden = true));

socket.emit('join', { name: myName, room, admin: isAdmin }, (res) => {
  if (res && res.ok) { adminKey = res.adminKey || null; apply(res.state); }
});

function apply(s) {
  state = s;
  $('round').textContent = s.round;
  $('zoom').textContent = s.level + 1;
  $('scores-v').textContent = (s.players || []).map((p) => `${p.name} ${p.score}`).join(' · ') || '–';
  const need = s.passNeeded ?? 0, got = s.passVotes ?? 0;
  const pv = $('passvote');
  pv.textContent = myVoted ? `✅ En attente (${got}/${need})` : `🙋 Demander à passer (${got}/${need})`;
  pv.disabled = myVoted || s.phase !== 'playing';
  img();
  countdown();
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

socket.on('state', apply);
socket.on('round:new', (s) => { $('banner').hidden = true; myVoted = false; apply(s); });
socket.on('round:zoom', apply);
socket.on('round:won', (d) => {
  apply(d);
  const b = $('banner');
  b.textContent = `🎉 ${d.winner} en ${d.elapsedSec}s`;
  b.hidden = false;
});
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
