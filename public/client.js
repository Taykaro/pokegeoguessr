const socket = io();

const $ = (id) => document.getElementById(id);
let room = 'main';
let state = null;
let countdownInterval = null;
let myName = '';
let isAdmin = false;

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('name-input').value.trim();
  myName = name;
  room = ($('room-input').value.trim() || 'main').toLowerCase();
  const admin = $('admin-input').checked;
  socket.emit('join', { name, room, admin }, (res) => {
    if (!res.ok) return alert(res.error);
    isAdmin = !!res.admin;
    $('join-screen').hidden = true;
    $('game-screen').hidden = false;
    $('room-name').textContent = room;
    if (isAdmin) $('admin-panel').hidden = false;
    applyState(res.state);
    log(`Tu as rejoint la room "${room}"${isAdmin ? ' (admin)' : ''}`);
  });
});

$('admin-skip').addEventListener('click', () => socket.emit('admin:skip'));
$('admin-reveal').addEventListener('click', () => {
  $('photo').src = `/img/${room}?full=1&t=${Date.now()}`;
});

socket.on('admin', (d) => {
  const t = d.target;
  $('admin-target').textContent = t
    ? (t.interior ? `${t.zone} [intérieur] map ${t.mapID} — (${t.gx}, ${t.gy})` : `${t.zone} — (${t.gx}, ${t.gy})`)
    : '–';
  const me = (d.players || []).find((p) => p.name.toLowerCase() === myName.toLowerCase());
  const pos = me && me.pos;
  $('admin-pos').textContent = pos ? `map ${pos.mapID} — (${pos.x}, ${pos.y})` : '– (lance le pont)';
  if (t && pos) {
    const dx = Math.abs(pos.x - t.gx), dy = Math.abs(pos.y - t.gy);
    const okMap = !t.interior || Number(pos.mapID) === t.mapID;
    const near = okMap && dx <= d.margin && dy <= d.margin;
    $('admin-dist').textContent = `Δ (${dx}, ${dy}) ${okMap ? '' : '· mauvaise carte'} ${near ? '✅ GAGNÉ' : ''}`;
  } else {
    $('admin-dist').textContent = '–';
  }
});

function applyState(s) {
  state = s;
  $('pack-name').textContent = s.packName;
  $('round-num').textContent = s.round;
  $('zoom-level').textContent = s.level + 1;
  $('zoom-max').textContent = s.maxLevel + 1;
  renderScores(s.players);
  refreshImage();
  startCountdown();
}

function refreshImage() {
  $('photo').src = `/img/${room}?t=${Date.now()}`;
}

function renderScores(players) {
  $('scoreboard').innerHTML = players
    .map((p) => `<li class="${p.offline ? 'offline' : ''}">${escapeHtml(p.name)} — <b>${p.score}</b></li>`)
    .join('');
}

function startCountdown() {
  clearInterval(countdownInterval);
  const el = $('countdown');
  if (!state || !state.nextZoomAt) { el.textContent = 'Zoom max'; return; }
  const tick = () => {
    const s = Math.max(0, Math.round((state.nextZoomAt - Date.now()) / 1000));
    el.textContent = `Dézoom dans ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  countdownInterval = setInterval(tick, 1000);
}

function log(msg) {
  const li = document.createElement('li');
  li.textContent = msg;
  $('log').prepend(li);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

socket.on('state', applyState);

socket.on('round:new', (s) => {
  $('banner').hidden = true;
  $('marker').hidden = true;
  applyState(s);
  log(`Round ${s.round} — nouvelle destination !`);
});

socket.on('round:zoom', (s) => {
  applyState(s);
  log(`Dézoom ! Niveau ${s.level + 1}/${s.maxLevel + 1}`);
});

socket.on('round:won', (data) => {
  applyState(data);
  const banner = $('banner');
  banner.textContent = `🎉 ${data.winner} a trouvé en ${data.elapsedSec}s !`;
  banner.hidden = false;
  const marker = $('marker');
  marker.style.left = `${data.marker.fx * 100}%`;
  marker.style.top = `${data.marker.fy * 100}%`;
  marker.hidden = false;
  log(`🏆 ${data.winner} a trouvé l'endroit (${data.elapsedSec}s)`);
});

socket.on('disconnect', () => log('⚠️ Déconnecté du serveur...'));
socket.on('connect', () => {
  if (state) log('Reconnecté — rejoins à nouveau la partie');
});

// Mode solo (application de bureau) : rejoint automatiquement en admin.
(() => {
  const solo = new URLSearchParams(location.search).get('solo');
  if (solo) {
    $('name-input').value = solo;
    $('admin-input').checked = true;
    $('join-form').requestSubmit();
  }
})();
