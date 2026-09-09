// Barrage match relay.
//
// Deliberately dumb: it knows about rooms and sockets, and nothing at all about
// artillery. Clients send `msg` frames and the relay hands them to the other
// members of the room untouched, so the whole game stays in index.html and
// there is no physics to keep in sync between two codebases.
//
//   node relay.mjs                 # relay on :8787, also serves the game
//   PORT=9000 node relay.mjs       # somewhere else
//   SERVE_GAME=0 node relay.mjs    # relay only
//
// Serving the game is a convenience for local play: open the printed URL in two
// browser windows and they can reach each other. In production the page is a
// static file on Pages and only the WebSocket endpoint comes from here.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PROTOCOL = 1;

// Room codes are read aloud and typed on phones, so the alphabet drops the
// characters people confuse: O/0, I/1, S/5.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ23456789';
const CODE_LEN = 4;

const MAX_MEMBERS = 4;        // matches MAX_PLAYERS in the game
const MAX_FRAME = 64 * 1024;  // a terrain snapshot is a few KB; this is slack
const MAX_MSGS_PER_SEC = 40;  // a turn is one message; this only stops floods
// An empty room is kept this long before it is forgotten. A room used to be
// destroyed the moment its last member left, so a brief disconnection -- a
// tunnel, a dropped wifi, both players reloading -- lost the code and the match
// with it. Holding it lets people come back to the same room.
const ROOM_GRACE_MS = 5 * 60 * 1000;
const SWEEP_MS = 30 * 1000;
const HEARTBEAT_MS = 30 * 1000;

/** @typedef {{id:number,name:string,socket:import('ws').WebSocket,room:Room|null,tokens:number,tokenAt:number}} Member */

class Room {
  constructor(code) {
    this.code = code;
    this.members = [];
    this.touched = Date.now();
    this.emptySince = null;  // when the last member left, or null while occupied
  }
  get full() { return this.members.length >= MAX_MEMBERS; }
  /** The first member still present. Clients use this to agree on seating. */
  get hostId() { return this.members.length ? this.members[0].id : null; }
  add(m) {
    this.members.push(m);
    this.touched = Date.now();
    this.emptySince = null;
  }
  remove(m) {
    const i = this.members.indexOf(m);
    if (i >= 0) this.members.splice(i, 1);
    this.touched = Date.now();
    if (this.members.length === 0) this.emptySince = Date.now();
  }
  /** Send to everyone except `except`. */
  broadcast(payload, except) {
    const text = JSON.stringify(payload);
    for (const m of this.members) {
      if (m !== except && m.socket.readyState === m.socket.OPEN) m.socket.send(text);
    }
    this.touched = Date.now();
  }
}

export function createRelay({ serveGame = process.env.SERVE_GAME !== '0',
                             roomGraceMs = ROOM_GRACE_MS,
                             sweepMs = SWEEP_MS } = {}) {
  /** @type {Map<string, Room>} */
  const rooms = new Map();
  let nextId = 1;

  const http = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      const occupied = [...rooms.values()].filter(r => r.members.length).length;
      res.end(JSON.stringify({
        ok: true, rooms: occupied, held: rooms.size - occupied, protocol: PROTOCOL
      }));
      return;
    }
    if (!serveGame) { res.writeHead(404).end('not found'); return; }
    await serveStatic(req, res);
  });

  const wss = new WebSocketServer({ server: http, maxPayload: MAX_FRAME });

  wss.on('connection', (socket) => {
    /** @type {Member} */
    const member = {
      id: nextId++, name: '', socket, room: null,
      tokens: MAX_MSGS_PER_SEC, tokenAt: Date.now()
    };

    const send = (payload) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };
    const fail = (code, msg) => { send({ t: 'err', code, msg }); };

    socket.__alive = true;
    socket.on('pong', () => { socket.__alive = true; });

    socket.on('message', (raw) => {
      if (!spendToken(member)) return fail('RATE', 'too many messages');

      let m;
      try { m = JSON.parse(raw.toString()); }
      catch { return fail('BAD_JSON', 'not JSON'); }
      if (!m || typeof m.t !== 'string') return fail('BAD_JSON', 'no type');

      if (m.t === 'join') {
        if (m.v !== PROTOCOL) {
          return fail('BAD_VERSION', `relay speaks protocol ${PROTOCOL}`);
        }
        if (member.room) return fail('ALREADY_JOINED', 'leave first');

        member.name = typeof m.name === 'string' ? m.name.slice(0, 24) : '';

        let room;
        if (m.room == null) {
          room = new Room(freshCode(rooms));
          rooms.set(room.code, room);
        } else {
          const code = String(m.room).toUpperCase();
          room = rooms.get(code);
          if (!room) return fail('NO_ROOM', `no room ${code}`);
          if (room.full) return fail('ROOM_FULL', 'room is full');
        }

        // Tell the newcomer who is already here, then tell them about it.
        const peers = room.members.map(p => ({ id: p.id, name: p.name }));
        room.add(member);
        member.room = room;
        send({ t: 'joined', room: room.code, id: member.id, host: room.hostId, peers });
        room.broadcast({ t: 'peer', id: member.id, name: member.name }, member);
        return;
      }

      if (m.t === 'msg') {
        if (!member.room) return fail('NOT_JOINED', 'join a room first');
        // `d` is the game's business, not ours — relayed verbatim.
        member.room.broadcast({ t: 'msg', from: member.id, d: m.d }, member);
        return;
      }

      if (m.t === 'bye') { socket.close(1000, 'bye'); return; }

      fail('BAD_TYPE', `unknown type ${m.t}`);
    });

    socket.on('close', () => {
      const room = member.room;
      if (!room) return;
      room.remove(member);
      member.room = null;
      // An emptied room is kept for ROOM_GRACE_MS rather than dropped here, so
      // the code still works if someone comes back. The sweep below collects it.
      // The game decides what a departure means (hand the tank to the AI, wait
      // for a rejoin); the relay only reports it.
      if (room.members.length) room.broadcast({ t: 'gone', id: member.id, host: room.hostId });
    });

    socket.on('error', () => { /* close follows */ });
  });

  // Drop sockets that stopped answering, so a player who closed their laptop
  // is reported gone instead of holding a seat forever.
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.__alive === false) { socket.terminate(); continue; }
      socket.__alive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (room.emptySince !== null && now - room.emptySince > roomGraceMs) rooms.delete(code);
    }
  }, sweepMs);
  sweep.unref?.();

  return {
    http,
    wss,
    rooms,
    listen(port = Number(process.env.PORT) || 8787) {
      return new Promise((ok) => http.listen(port, () => ok(http.address().port)));
    },
    async close() {
      clearInterval(heartbeat);
      clearInterval(sweep);
      for (const c of wss.clients) c.terminate();
      await new Promise((ok) => wss.close(ok));
      // http.close only fires once every connection has gone; upgraded sockets
      // can outlive their WebSocket, so cut them rather than wait.
      http.closeAllConnections?.();
      await new Promise((ok) => http.close(ok));
    }
  };
}

function spendToken(member) {
  const now = Date.now();
  const elapsed = (now - member.tokenAt) / 1000;
  member.tokenAt = now;
  member.tokens = Math.min(MAX_MSGS_PER_SEC, member.tokens + elapsed * MAX_MSGS_PER_SEC);
  if (member.tokens < 1) return false;
  member.tokens -= 1;
  return true;
}

function freshCode(rooms) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LEN; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error('could not find a free room code');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = resolve(join(ROOT, rel));
  // Never serve outside the repo, whatever the path claims to be.
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end('nope'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

// Started directly (rather than imported by a test): listen and say where.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const relay = createRelay();
  const port = await relay.listen();
  console.log(`relay      ws://localhost:${port}`);
  if (process.env.SERVE_GAME !== '0') console.log(`game       http://localhost:${port}/`);
  console.log('health     /health');
}
