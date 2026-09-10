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
  hs.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: 'tok2' } });
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
    // Hold the turn where it is: minutes of game time would otherwise run the
    // turn clock out, hand play to the guest, and make it the owner fairly.
    host.g.netResetTurnClock();
    guest.g.netResetTurnClock();
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

test('a helicopter arriving mid-turn is seen at once, not at the end of it', () => {
  const { host, guest, hs, gs } = liveMatch();
  for (const c of [host, guest]) { c.g.heli = null; c.g.state = 'AIMING'; }
  assert.equal(host.g.currentPlayer, 0, 'the host holds the turn');

  // Run until the owner's timer brings one in. No shot is taken, so no sync
  // goes out — this is exactly the window where the other player used to see
  // nothing at all.
  assert.ok(host.advanceUntil(() => host.g.heli !== null, { maxMs: 200000 }));
  const announced = hs.payloads('heli');
  assert.equal(announced.length, 1, 'it is announced when it appears');
  assert.deepEqual(hs.payloads('sync'), [], 'and not because a turn ended');

  gs.deliver({ t: 'msg', from: 1, d: announced[0] });
  assert.ok(guest.g.heli, 'the other player can see it now');
  assert.equal(guest.g.heli.x, host.g.heli.x);
  assert.equal(guest.g.heliTimer, host.g.heliTimer);
});

test('a helicopter leaving is announced too', () => {
  const { host, guest, hs, gs } = liveMatch();
  const airborne = {
    x: 500, y: 120, dir: 1, speed: 400, vy: 0, falling: false, spin: 0,
    legs: 9, seen: [0, 1]     // out of legs: the next edge retires it
  };
  const snap = host.g.netSnapshot();
  snap.heli = airborne;
  host.g.netApplyState(JSON.parse(JSON.stringify(snap)));
  gs.deliver({ t: 'msg', from: 1, d: { k: 'heli', heli: airborne, heliTimer: 60 } });
  assert.ok(guest.g.heli, 'both have it');

  host.advance(4000);
  assert.equal(host.g.heli, null, 'the owner retires it');

  const last = hs.payloads('heli').slice(-1)[0];
  assert.equal(last.heli, null, 'and says so');
  gs.deliver({ t: 'msg', from: 1, d: last });
  assert.equal(guest.g.heli, null, 'so it does not linger on the other screen');
});

test('a client that does not own it stays quiet', () => {
  const { guest, gs } = liveMatch();
  guest.g.heli = null;
  guest.g.currentPlayer = 0;   // not our seat
  guest.g.state = 'AIMING';
  // Hold the turn where it is: minutes of game time would otherwise run the
  // turn clock out and hand play — and the helicopter with it — to us fairly.
  for (let i = 0; i < 40; i++) {
    guest.g.netResetTurnClock();
    guest.advance(5000);
  }
  assert.equal(guest.g.heli, null, 'we never spawn one on their turn');
  assert.deepEqual(gs.payloads('heli'), [], 'nothing to announce, and no right to');
});

test('a shot-down helicopter crashes on every screen, not just the shooter’s', () => {
  const { host, guest, gs } = liveMatch();
  for (const c of [host, guest]) { c.flatTerrain(400); c.placeTanksAt([150, 850]); }

  // Falling, over open ground, well clear of both tanks.
  const falling = {
    x: 500, y: 200, dir: 1, speed: 60, vy: 120,
    falling: true, spin: 0, legs: 1, seen: [0, 1]
  };
  gs.deliver({ t: 'msg', from: 1, d: { k: 'heli', heli: falling, heliTimer: 90 } });
  assert.ok(guest.g.heli, 'the guest can see it coming down');
  assert.equal(guest.g.currentPlayer, 0, 'and it is not the guest’s turn');

  const groundWas = guest.g.groundHeightAt(500);
  guest.advanceUntil(() => guest.g.heli === null, { maxMs: 12000 });

  // It used to fall through the terrain and off the bottom of the screen,
  // still airborne, until an announcement happened to remove it.
  assert.equal(guest.g.heli, null, 'it is gone');
  assert.ok(guest.g.groundHeightAt(500) > groundWas,
    `it left a crater: ground ${groundWas} -> ${guest.g.groundHeightAt(500)}`);
  assert.ok(guest.g.explosions.length > 0 || guest.g.particles.length > 0,
    'and made a mess doing it');
});

test('but only the seat holding the turn moves play on after a crash', () => {
  const { guest, gs } = liveMatch();
  guest.flatTerrain(400);
  guest.placeTanksAt([150, 850]);
  guest.g.currentPlayer = 0;          // the host's turn, not ours
  guest.g.state = 'AIMING';

  // A crash right on top of the seat whose turn it is.
  guest.g.tanks[0].hp = 5;
  guest.g.heliCrash(150, guest.g.groundHeightAt(150));

  assert.equal(guest.g.tanks[0].alive, false, 'the blast still lands here');
  assert.equal(guest.g.currentPlayer, 0,
    'but we do not advance the turn ourselves — that would move play twice');
});
