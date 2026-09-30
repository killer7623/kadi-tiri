'use strict';
/* Kali Ni Tidi online server. No dependencies: plain Node http + Server-Sent Events. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./engine');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
const MODES = { s4: { n: 4, decks: 1 }, s5: { n: 5, decks: 1 }, d6: { n: 6, decks: 2 } };
const BOT_NAMES = ['Hetal', 'Bhavin', 'Krupa', 'Jayesh', 'Meera', 'Dhruv', 'Nisha', 'Kabir', 'Anaya', 'Rohan'];
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;

const SPEED = process.env.KT_FAST ? 0.01 : 1; // tests only
const rooms = new Map();

/* ---------- helpers ---------- */
const rid = () => crypto.randomBytes(12).toString('hex');
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
function cleanName(s) {
  s = String(s || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  return s || 'Player';
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 20000) { req.destroy(); resolve({}); } });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const uid8 = () => crypto.randomBytes(4).toString('hex');
const isConnected = (room, pid) => !!(pid && room.clients.get(pid) && room.clients.get(pid).size);
const human = (room, pid) => room.players.find(p => p.pid === pid);

function makeRoom(mode, hostName) {
  const pid = rid();
  const room = {
    code: newCode(), mode, players: [{ pid, uid: uid8(), name: hostName }], hostPid: pid, voice: new Set(),
    g: null, seats: null, seatOf: {}, spectators: new Map(), clients: new Map(), timer: null, last: Date.now()
  };
  rooms.set(room.code, room);
  return { room, pid };
}
function uidOf(room, pid) {
  const p = human(room, pid);
  if (p) return p.uid;
  const s = room.seats && room.seats[room.seatOf[pid]];
  if (s) return s.uid;
  const sp = room.spectators.get(pid);
  return sp ? sp.uid : null;
}
function pidOfUid(room, uid) {
  const p = room.players.find(x => x.uid === uid);
  if (p) return p.pid;
  const s = room.seats && room.seats.find(x => x && x.kind === 'human' && x.uid === uid);
  if (s) return s.pid;
  for (const [pid, sp] of room.spectators) if (sp.uid === uid) return pid;
  return null;
}
function spectatorList(room, pid) {
  return Array.from(room.spectators.entries()).map(([spid, s]) => ({ name: s.name, me: spid === pid }));
}
function sendTo(room, pid, event, obj) {
  const set = room.clients.get(pid);
  if (!set) return false;
  const msg = 'event: ' + event + '\ndata: ' + JSON.stringify(obj) + '\n\n';
  for (const res of set) { try { res.write(msg); } catch (e) { /* closed */ } }
  return true;
}
function botName(room) {
  const used = new Set(room.seats ? room.seats.filter(Boolean).map(s => s.name) : []);
  return BOT_NAMES.find(n => !used.has(n)) || 'Bot';
}

/* ---------- views: each player only ever receives their own hand ---------- */
function view(room, pid) {
  const g = room.g;
  const spectating = room.spectators.has(pid);
  if (!g) {
    return {
      stage: 'lobby', code: room.code, mode: room.mode, n: MODES[room.mode].n,
      isHost: pid === room.hostPid, spectating,
      myUid: uidOf(room, pid), voice: Array.from(room.voice),
      players: room.players.map(p => ({ uid: p.uid, name: p.name, host: p.pid === room.hostPid, me: p.pid === pid, online: isConnected(room, p.pid) })),
      spectators: spectatorList(room, pid)
    };
  }
  const me = spectating ? null : room.seatOf[pid];
  const acting = E.whoActs(g);
  const faces = {};
  g.fullDeck.forEach(c => { faces[c.f] = (faces[c.f] || 0) + 1; });
  return {
    stage: 'game', code: room.code, me, n: g.n, decks: g.decks, total: g.total, minBid: g.minBid, maxCap: g.maxCap, pc: g.pc,
    names: room.seats.map(s => s.name),
    uids: room.seats.map(s => s.kind === 'human' ? s.uid : null),
    myUid: uidOf(room, pid), voice: Array.from(room.voice),
    kinds: room.seats.map(s => s.kind),
    online: room.seats.map(s => s.kind === 'bot' ? true : isConnected(room, s.pid)),
    round: g.round, phase: g.phase, acting,
    bid: { amount: g.bid.amount, by: g.bid.by, last: g.bid.last, turn: g.bid.turn },
    bidder: g.bidder, trump: g.trump,
    called: g.called.map(c => ({ f: c.f, n: c.n, pattern: c.pattern, by: c.by === undefined ? null : c.by })),
    revealed: Array.from(g.revealed),
    hand: me != null ? g.hands[me] : [], counts: g.hands.map(h => h.length),
    legal: (me != null && g.phase === 'play' && g.turn === me) ? E.legal(g, me).map(c => c.id) : [],
    taken: g.taken, scores: g.scores, spectating, spectators: spectatorList(room, pid),
    trick: g.trick, turn: g.turn, winner: g.winner, trickPts: g.trickPts,
    result: g.result, faces, canEndEarly: E.canEndEarly(g),
    penalty: g.penalty ? {
      partners: g.penalty.partners, votes: g.penalty.votes, bid: g.bid.amount, tp: g.penalty.res.tp,
      youVote: g.penalty.partners.indexOf(me) >= 0 ? (g.penalty.votes[me] === undefined ? null : g.penalty.votes[me]) : undefined
    } : null
  };
}
function broadcast(room) {
  for (const [pid, set] of room.clients) {
    if (!set.size) continue;
    const data = 'data: ' + JSON.stringify(view(room, pid)) + '\n\n';
    for (const res of set) { try { res.write(data); } catch (e) { /* closed */ } }
  }
}

/* ---------- turn scheduling: computer players, and humans who are offline ---------- */
function botAct(room, s) {
  const g = room.g;
  if (!g) return;
  if (g.phase === 'penalty') { E.doPenaltyVote(g, s, E.botPenaltyVote()); return; }
  if (E.whoActs(g) !== s) return;
  if (g.phase === 'bid') { const a = E.botBid(g, s); if (a) E.doBid(g, s, a); else E.doPass(g, s); }
  else if (g.phase === 'call') { const c = E.botCall(g); E.doCall(g, s, c.trump, c.called); }
  else if (g.phase === 'play') E.doPlay(g, s, E.chooseCard(g, s).id);
}
function afterChange(room) { room.last = Date.now(); broadcast(room); schedule(room); }
function schedule(room) {
  clearTimeout(room.timer); room.timer = null;
  const g = room.g;
  if (!g) return;
  if (g.phase === 'trickEnd') { room.timer = setTimeout(() => { E.clearTrick(g); afterChange(room); }, 1700 * SPEED); return; }
  if (g.phase === 'penalty') {
    const pending = E.pendingPenaltyVoters(g);
    if (!pending.length) return;
    let actor = null, delay = Infinity;
    pending.forEach(p => {
      const seat = room.seats[p];
      const d = seat.kind === 'bot' ? 900 + Math.random() * 500 : (isConnected(room, seat.pid) ? Infinity : 7000);
      if (d < delay) { delay = d; actor = p; }
    });
    if (actor === null) return; // every remaining voter is an online human; wait for them
    room.timer = setTimeout(() => { botAct(room, actor); afterChange(room); }, delay * SPEED);
    return;
  }
  const s = E.whoActs(g);
  if (s === null) return;
  const seat = room.seats[s];
  if (seat.kind === 'human' && isConnected(room, seat.pid)) return; // wait for the person
  const delay = (seat.kind === 'bot' ? 900 + Math.random() * 500 : 7000) * SPEED; // grace period before covering an offline player
  room.timer = setTimeout(() => { botAct(room, s); afterChange(room); }, delay);
}

/* ---------- game start and seating ---------- */
function startGame(room) {
  const { n, decks } = MODES[room.mode];
  const humans = room.players;
  const seats = Array.from({ length: n }, () => null);
  humans.forEach((p, j) => { seats[Math.floor(j * n / humans.length)] = { kind: 'human', pid: p.pid, uid: p.uid, name: p.name }; });
  room.seats = seats;
  seats.forEach((s, i) => { if (!s) seats[i] = { kind: 'bot', pid: null, name: botName(room) }; });
  room.seatOf = {};
  seats.forEach((s, i) => { if (s.kind === 'human') room.seatOf[s.pid] = i; });
  room.g = E.newGame(n, decks);
  E.startRound(room.g);
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const p = url.pathname;

  if (req.method === 'GET' && p === '/api/events') {
    const room = rooms.get(String(url.searchParams.get('room') || '').toUpperCase());
    const pid = url.searchParams.get('pid');
    const known = room && (human(room, pid) || (room.seatOf && room.seatOf[pid] !== undefined) || (room.spectators && room.spectators.has(pid)));
    if (!known) return json(res, 404, { error: 'Room not found' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');
    if (!room.clients.has(pid)) room.clients.set(pid, new Set());
    room.clients.get(pid).add(res);
    res.write('data: ' + JSON.stringify(view(room, pid)) + '\n\n');
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* closed */ } }, 15000);
    req.on('close', () => {
      clearInterval(ping);
      const set = room.clients.get(pid);
      if (set) { set.delete(res); if (!set.size) { room.clients.delete(pid); room.voice.delete(uidOf(room, pid)); } }
      afterChange(room);
    });
    afterChange(room); // shows "online" to others and cancels any bot cover
    return;
  }

  if (req.method === 'GET' && p === '/api/ice') {
    const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    const turn = (process.env.KT_TURN_URLS || '').split(',').map(x => x.trim()).filter(Boolean);
    if (turn.length) servers.push({ urls: turn, username: process.env.KT_TURN_USER || '', credential: process.env.KT_TURN_PASS || '' });
    return json(res, 200, { iceServers: servers, relay: turn.length > 0 });
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const b = await readBody(req);

  if (p === '/api/create') {
    const mode = MODES[b.mode] ? b.mode : 's4';
    const { room, pid } = makeRoom(mode, cleanName(b.name));
    return json(res, 200, { room: room.code, pid });
  }

  if (p === '/api/spectate') {
    const room = rooms.get(String(b.room || '').toUpperCase().trim());
    if (!room) return json(res, 404, { error: 'No room with that code' });
    if (room.spectators.size >= 50) return json(res, 409, { error: 'Too many spectators in this room' });
    const pid = rid();
    room.spectators.set(pid, { uid: uid8(), name: cleanName(b.name) });
    afterChange(room);
    return json(res, 200, { room: room.code, pid });
  }

  if (p === '/api/join') {
    const room = rooms.get(String(b.room || '').toUpperCase().trim());
    if (!room) return json(res, 404, { error: 'No room with that code' });
    const name = cleanName(b.name);
    if (!room.g) {
      if (room.players.length >= MODES[room.mode].n) return json(res, 409, { error: 'That room is full. You can watch as a spectator instead.', canSpectate: true });
      const pid = rid();
      room.players.push({ pid, uid: uid8(), name });
      afterChange(room);
      return json(res, 200, { room: room.code, pid });
    }
    const seatIdx = room.seats.findIndex(s => s.kind === 'bot');
    if (seatIdx < 0) return json(res, 409, { error: 'That room is full. You can watch as a spectator instead.', canSpectate: true });
    const pid = rid();
    room.seats[seatIdx] = { kind: 'human', pid, uid: uid8(), name };
    room.seatOf[pid] = seatIdx;
    afterChange(room);
    return json(res, 200, { room: room.code, pid });
  }

  const room = rooms.get(String(b.room || '').toUpperCase());
  if (!room) return json(res, 404, { error: 'Room not found' });

  if (p === '/api/leave') {
    room.voice.delete(uidOf(room, b.pid));
    if (room.spectators.has(b.pid)) {
      room.spectators.delete(b.pid);
      const set = room.clients.get(b.pid);
      if (set) { for (const r of set) { try { r.end(); } catch (e) { /* closed */ } } room.clients.delete(b.pid); }
      afterChange(room);
      return json(res, 200, { ok: true });
    }
    if (!room.g) {
      room.players = room.players.filter(x => x.pid !== b.pid);
      if (room.hostPid === b.pid && room.players.length) room.hostPid = room.players[0].pid;
    } else if (room.seatOf[b.pid] !== undefined) {
      const i = room.seatOf[b.pid];
      room.seats[i] = { kind: 'bot', pid: null, name: botName(room) };
      room.g.names[i] = room.seats[i].name;
      delete room.seatOf[b.pid];
    }
    const set = room.clients.get(b.pid);
    if (set) { for (const r of set) { try { r.end(); } catch (e) { /* closed */ } } room.clients.delete(b.pid); }
    if (!room.g && !room.players.length) rooms.delete(room.code);
    else afterChange(room);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/voice') {
    const uid = uidOf(room, b.pid);
    if (!uid) return json(res, 403, { error: 'You are not in this room' });
    if (b.on) { room.voice.delete(uid); room.voice.add(uid); } else room.voice.delete(uid); // joining puts you last in the order
    afterChange(room);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/signal') {
    const from = uidOf(room, b.pid);
    if (!from || !room.voice.has(from)) return json(res, 403, { error: 'Join the voice chat first' });
    const toPid = pidOfUid(room, String(b.to || ''));
    if (!toPid || !room.voice.has(b.to)) return json(res, 404, { error: 'That player is not in the voice chat' });
    if (!['offer', 'answer', 'ice', 'cam'].includes(b.kind)) return json(res, 400, { error: 'Bad signal' });
    sendTo(room, toPid, 'signal', { from, kind: b.kind, data: b.data });
    return json(res, 200, { ok: true });
  }

  if (p !== '/api/act') return json(res, 404, { error: 'Unknown endpoint' });
  const pid = b.pid, g = room.g;

  if (!g) { // lobby actions
    if (!human(room, pid)) return json(res, 403, { error: 'You are not in this room' });
    if (pid !== room.hostPid) return json(res, 403, { error: 'Only the host can do that' });
    if (b.type === 'mode') {
      if (!MODES[b.mode]) return json(res, 400, { error: 'Unknown mode' });
      if (room.players.length > MODES[b.mode].n) return json(res, 409, { error: 'Too many players for that mode' });
      room.mode = b.mode; afterChange(room); return json(res, 200, { ok: true });
    }
    if (b.type === 'start') { startGame(room); afterChange(room); return json(res, 200, { ok: true }); }
    return json(res, 400, { error: 'Not available in the lobby' });
  }

  const seat = room.seatOf[pid];
  if (seat === undefined) return json(res, 403, { error: 'You are not seated in this room' });
  let ok = false;
  if (b.type === 'bid') ok = E.doBid(g, seat, b.amount);
  else if (b.type === 'pass') ok = E.doPass(g, seat);
  else if (b.type === 'call') ok = E.doCall(g, seat, b.trump, b.called);
  else if (b.type === 'play') ok = E.doPlay(g, seat, String(b.card));
  else if (b.type === 'next') { if (g.phase === 'end') { E.startRound(g); ok = true; } }
  else if (b.type === 'endEarly') { if (seat === g.bidder) ok = E.endEarly(g); }
  else if (b.type === 'penaltyVote') ok = E.doPenaltyVote(g, seat, !!b.agree);
  if (!ok) return json(res, 409, { error: 'That move is not allowed right now' });
  afterChange(room);
  return json(res, 200, { ok: true });
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(err => { console.error(err); try { json(res, 500, { error: 'Server error' }); } catch (e) { /* ignore */ } });
    return;
  }
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  let rel;
  try { rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''); }
  catch (e) { res.writeHead(400); return res.end(); }
  const file = path.normalize(path.join(PUBLIC, rel));
  const type = TYPES[path.extname(file).toLowerCase()];
  if (file.startsWith(PUBLIC + path.sep) && type) {
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      const h = { 'Content-Type': type, 'Cache-Control': rel === 'sw.js' || rel === 'index.html' || rel === 'manifest.webmanifest' ? 'no-cache' : 'public, max-age=86400' };
      if (rel === 'sw.js') h['Service-Worker-Allowed'] = '/';
      res.writeHead(200, h); res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.last > ROOM_IDLE_MS && ![...room.clients.values()].some(s => s.size)) { clearTimeout(room.timer); rooms.delete(code); }
  }
}, 10 * 60 * 1000).unref();

if (require.main === module) server.listen(PORT, () => console.log('Kali Ni Tidi online on port ' + PORT));
module.exports = { server, rooms };
