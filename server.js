// Austin's Fantasy DD's — static file server + WebSocket game rooms.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('./minews.js');
const Sim = require('./public/sim.js');

const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://local');
  if (u.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    return res.end('ok');
  }
  const file = path.normalize(path.join(PUB, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname)));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });
const rooms = new Map();
const CODE_CH = 'ABCDEFGHJKMNPQRSTUVWXYZ';
let idc = 1;
const uid = () => 'p' + (idc++) + Math.random().toString(36).slice(2, 6);
const cleanName = n => (String(n || '').replace(/[<>&"]/g, '').trim().slice(0, 14)) || 'Player';
const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
function newCode() { let c; do { c = Array.from({ length: 4 }, () => CODE_CH[Math.floor(Math.random() * CODE_CH.length)]).join(''); } while (rooms.has(c)); return c; }
function broadcast(room, m) { const s = JSON.stringify(m); for (const p of room.members) if (p.ws && p.ws.readyState === 1) p.ws.send(s); }
function lobbyMsg(room) {
  return {
    t: 'lobby', code: room.code, host: room.host, phase: room.phase,
    players: room.members.map((m, i) => ({ id: m.id, name: m.name, cpu: m.cpu, color: Sim.COLORS[i] })),
    inGame: room.sim ? room.sim.players.map(p => p.id) : [],
  };
}
const humans = room => room.members.filter(m => !m.cpu);
let botN = 1;
const BOT_NAMES = ['Bolt', 'Sprocket', 'Gizmo', 'Rivet', 'Torque', 'Ratchet', 'Widget', 'Cog'];

function startGame(room) {
  if (room.members.length < 2) return false;
  room.sim = Sim.create(room.members.map(m => ({ id: m.id, name: m.name, cpu: m.cpu })));
  room.phase = 'playing';
  broadcast(room, lobbyMsg(room));
  return true;
}
function leave(ws) {
  const room = ws.room; if (!room) return;
  ws.room = null;
  room.members = room.members.filter(m => m.id !== ws.pid);
  if (room.sim) { const p = room.sim.players.find(p => p.id === ws.pid); if (p) { p.cpu = true; p.name += ' (bot)'; } }
  if (!humans(room).length) { rooms.delete(room.code); return; }
  if (room.host === ws.pid) room.host = humans(room)[0].id;
  broadcast(room, lobbyMsg(room));
}

wss.on('connection', ws => {
  ws.pid = uid(); ws.alive = true; ws.room = null;
  ws.on('pong', () => { ws.alive = true; });
  send(ws, { t: 'hello', id: ws.pid });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const room = ws.room;
    switch (m.t) {
      case 'create': {
        if (room) leave(ws);
        const r = { code: newCode(), members: [{ id: ws.pid, name: cleanName(m.name), cpu: false, ws }], host: ws.pid, phase: 'lobby', sim: null };
        rooms.set(r.code, r); ws.room = r;
        send(ws, lobbyMsg(r));
        break;
      }
      case 'join': {
        const r = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!r) return send(ws, { t: 'error', msg: 'No game with that code. Check the letters and try again.' });
        if (r.members.length >= Sim.MAX_PLAYERS) return send(ws, { t: 'error', msg: 'That game is full (6 players max).' });
        if (room) leave(ws);
        r.members.push({ id: ws.pid, name: cleanName(m.name), cpu: false, ws }); ws.room = r;
        broadcast(r, lobbyMsg(r));
        if (r.phase === 'playing') send(ws, { t: 'note', msg: 'Game in progress. You\'re watching and will join the next round.' });
        break;
      }
      case 'bot': {
        if (!room || room.host !== ws.pid || room.phase === 'playing') return;
        if (m.add && room.members.length < Sim.MAX_PLAYERS) room.members.push({ id: 'b' + (botN++), name: BOT_NAMES[botN % BOT_NAMES.length], cpu: true, ws: null });
        if (!m.add) { const i = room.members.map(x => x.cpu).lastIndexOf(true); if (i >= 0) room.members.splice(i, 1); }
        broadcast(room, lobbyMsg(room));
        break;
      }
      case 'start': {
        if (!room || room.host !== ws.pid || room.phase === 'playing') return;
        if (!startGame(room)) send(ws, { t: 'error', msg: 'You need at least 2 players. Add a CPU or wait for a friend.' });
        break;
      }
      case 'lobby': {
        if (!room || room.host !== ws.pid || room.phase !== 'over') return;
        room.phase = 'lobby'; room.sim = null; broadcast(room, lobbyMsg(room));
        break;
      }
      case 'fire': {
        if (room && room.phase === 'playing') Sim.fire(room.sim, ws.pid, m.a);
        break;
      }
      case 'leave': leave(ws); break;
    }
  });
  ws.on('close', () => leave(ws));
});

let last = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  for (const room of rooms.values()) {
    if (room.phase !== 'playing') continue;
    Sim.step(room.sim, dt);
    const ev = room.sim.events; room.sim.events = [];
    broadcast(room, { t: 'state', s: Sim.snapshot(room.sim), ev });
    if (room.sim.over) { room.phase = 'over'; broadcast(room, lobbyMsg(room)); }
  }
}, 33);

setInterval(() => {
  for (const c of wss.clients) { if (!c.alive) { c.terminate(); continue; } c.alive = false; c.ping(); }
}, 25000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('DD server on :' + PORT));
