// The helicopter in a match. It is the one part of the world that used to be
// rolled independently on each client — its arrival ran off a local wall clock
// and its own Math.random — so one player could be shooting at a helicopter the
// other could not see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadFlat } from './harness.mjs';

function fakeSocket() {
  const listeners = {};
  const sock = {
    readyState: 1, sent: [],
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    send(text) { sock.sent.push(JSON.parse(text)); },
    close() { sock.readyState = 3; (listeners.close || []).forEach(fn => fn()); },
    emit(t, ev) { (listeners[t] || []).forEach(fn => fn(ev)); },
    deliver(obj) { sock.emit('message', { data: JSON.stringify(obj) }); },
    payloads(kind) {
      return sock.sent.filter(m => m.t === 'msg' && (!kind || m.d.k === kind)).map(m => m.d);
    }
  };
  return sock;
}
const connect = (h, room) => {
  const s = fakeSocket();
  h.g.setSocketFactory(() => s);
  h.g.netConnect(room);
  s.emit('open');
  return s;
};

/** Two clients in a live match. Seat 0 is the host, seat 1 the guest. */
function liveMatch(opts = {}) {
  const host = loadFlat(opts), guest = loadFlat(opts);
  const hs = connect(host), gs = connect(guest, 'ABCD');
  hs.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  gs.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  hs.deliver({ t: 'peer', id: 2, name: '' });
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  return { host, guest, hs, gs };
}

test('offline, the helicopter still arrives on its own', () => {
  const h = loadFlat();
  h.g.heli = null;
  h.g.state = 'AIMING';
  assert.equal(h.g.online.status, 'offline');
  assert.ok(h.advanceUntil(() => h.g.heli !== null, { maxMs: 200000 }),
    'nothing about the change stops a single-player game');
});

test('only the player whose turn it is brings one in', () => {
  const { host, guest } = liveMatch();
  for (const c of [host, guest]) { c.g.heli = null; c.g.state = 'AIMING'; }
  assert.equal(host.g.currentPlayer, 0, 'it is the host seat');

  // Poll rather than checking at the end: one arrives, flies its legs and
  // leaves again well inside this window, so a single look at the end sees
  // nothing either way.
  let hostSawOne = false, guestSawOne = false;
  for (let i = 0; i < 60; i++) {
    host.advance(5000);
    guest.advance(5000);
    if (host.g.heli) hostSawOne = true;
    if (guest.g.heli) guestSawOne = true;
  }
  assert.ok(hostSawOne, 'the seat holding the turn brings one in');
  assert.equal(guestSawOne, false, 'the other client never invents its own');
});

test('the whole helicopter travels, not a sketch of it', () => {
  const { host, guest, hs, gs } = liveMatch();
  host.g.heli = {
    x: 321, y: 150, dir: -1, speed: 88,
    vy: 42, falling: true, spin: 1.75, legs: 2, seen: new Set([0, 1])
  };
  host.g.heliTimer = 17.5;

  const snap = JSON.parse(JSON.stringify(host.g.netSnapshot()));
  gs.deliver({ t: 'msg', from: 1, d: { k: 'sync', state: snap } });

  const h = guest.g.heli;
  assert.ok(h, 'it arrived');
  for (const f of ['x', 'y', 'dir', 'speed', 'vy', 'falling', 'spin', 'legs']) {
    assert.equal(h[f], host.g.heli[f], `${f} survived the trip`);
  }
  assert.deepEqual([...h.seen].sort(), [0, 1], 'including who has had a crack at it');
  assert.equal(guest.g.heliTimer, 17.5, 'and the countdown to the next one');
});

test('a stale helicopter is replaced, not merged over', () => {
  const { guest, gs } = liveMatch();
  guest.g.heli = { x: 10, y: 20, dir: 1, speed: 50, vy: 99, falling: true, spin: 5, legs: 4, seen: new Set([1]) };

  const fresh = guest.g.netSnapshot();
  fresh.heli = { x: 500, y: 100, dir: -1, speed: 60, vy: 0, falling: false, spin: 0, legs: 0, seen: [] };
  guest.g.netApplyState(JSON.parse(JSON.stringify(fresh)));

  assert.equal(guest.g.heli.vy, 0, 'no leftovers from the one we had');
  assert.equal(guest.g.heli.legs, 0);
  assert.equal(guest.g.heli.falling, false);
  assert.deepEqual([...guest.g.heli.seen], []);
});

test('a helicopter that leaves is gone for both, and only once', () => {
  const { host, guest, hs, gs } = liveMatch();
  const airborne = {
    x: 500, y: 120, dir: 1, speed: 400, vy: 0, falling: false, spin: 0,
    legs: 9, seen: [0, 1]   // already flown its legs: the next edge ends it
  };
  const snap = host.g.netSnapshot();
  snap.heli = airborne;
  host.g.netApplyState(JSON.parse(JSON.stringify(snap)));
  guest.g.netApplyState(JSON.parse(JSON.stringify(snap)));

  host.advance(4000);
  guest.advance(4000);

  assert.equal(host.g.heli, null, 'the seat with the turn retires it');
  assert.ok(guest.g.heli, 'the other client keeps its copy until told');

  // The sync is what removes it there.
  guest.g.netApplyState(JSON.parse(JSON.stringify(host.g.netSnapshot())));
  assert.equal(guest.g.heli, null);
});

test('summoning one on somebody else’s turn does nothing', () => {
  const { guest } = liveMatch();
  guest.g.heli = null;
  guest.g.currentPlayer = 0;    // the host's turn; we are seat 1
  guest.g.state = 'AIMING';

  guest.g.summonHeli();

  assert.equal(guest.g.heli, null, 'we cannot conjure one for ourselves alone');

  guest.g.currentPlayer = 1;    // our turn
  guest.g.summonHeli();
  assert.ok(guest.g.heli, 'but we can on our own turn');
});
