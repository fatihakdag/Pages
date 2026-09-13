// The helicopter in a match. It is the one part of the world that used to be
// rolled independently on each client — its arrival ran off a local wall clock
// and its own Math.random — so one player could be shooting at a helicopter the
// other could not see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadFlat, routeHeli } from './harness.mjs';

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
  const { host, guest, gs } = liveMatch();
  host.g.heli = host.g.heliIn(routeHeli(host.g, { x: 321, y: 150, dir: -1, speed: 88, legsTotal: 3 }));
  host.g.heliTimer = 17.5;

  let snap = JSON.parse(JSON.stringify(host.g.netSnapshot()));
  gs.deliver({ t: 'msg', from: 1, d: { k: 'sync', state: snap } });
  const h = guest.g.heli;
  assert.ok(h, 'it arrived');
  for (const f of ['id', 't0', 'fromLeft', 'speed', 'legsTotal', 'x', 'y', 'dir', 'legs']) {
    assert.equal(h[f], host.g.heli[f], `${f} survived the trip`);
  }
  assert.deepEqual(h.ys, host.g.heli.ys, 'every leg’s altitude');
  assert.deepEqual([...h.seen].sort(), [0, 1], 'including who has had a crack at it');
  assert.equal(guest.g.heliTimer, 17.5, 'and the countdown to the next one');

  // A wreck is off its route: its own position and fall travel instead.
  host.g.heli = { id: 9, falling: true, t: host.g.netNow(), x: 321, y: 150, dir: -1, speed: 88,
                  vy: 42, spin: 1.75, ys: [], seen: new Set([0, 1]) };
  snap = JSON.parse(JSON.stringify(host.g.netSnapshot()));
  gs.deliver({ t: 'msg', from: 1, d: { k: 'sync', state: snap } });
  for (const f of ['x', 'y', 'dir', 'speed', 'vy', 'spin', 'falling', 't']) {
    assert.equal(guest.g.heli[f], host.g.heli[f], `the wreck's ${f} survived the trip`);
  }
});

test('a stale helicopter is replaced, not merged over', () => {
  const { guest } = liveMatch();
  guest.g.heli = { id: 2, x: 10, y: 20, dir: 1, speed: 50, vy: 99, falling: true, spin: 5, t: guest.g.netNow(), ys: [], seen: new Set([1]) };

  const fresh = guest.g.netSnapshot();
  fresh.heli = routeHeli(guest.g, { x: 500, seen: [] });
  guest.g.netApplyState(JSON.parse(JSON.stringify(fresh)));

  assert.equal(guest.g.heli.falling, false, 'no leftovers from the one we had');
  assert.equal(guest.g.heli.legs, 0);
  assert.ok(Math.abs(guest.g.heli.x - 500) < 1e-9);
  assert.deepEqual([...guest.g.heli.seen], []);
});

test('a helicopter leaves at the same moment on every screen, without a word', () => {
  const { host, guest, gs } = liveMatch();
  const route = routeHeli(host.g, { x: 900, speed: 400, legsTotal: 1 });   // its last leg: the edge ends it
  host.g.heli = host.g.heliIn(route);
  guest.g.heli = guest.g.heliIn(route);

  host.advance(1000);
  guest.advance(1000);

  assert.equal(host.g.heli, null, 'gone here');
  assert.equal(guest.g.heli, null, 'and gone there too, with nothing sent to say so');
  assert.deepEqual(gs.payloads('heli'), []);
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
  const T = host.g.netNow();
  assert.deepEqual({ ...guest.g.heliRouteAt(guest.g.heli, T) }, { ...host.g.heliRouteAt(host.g.heli, T) },
    'on the same route, so in the same place at any moment');
  assert.equal(guest.g.heliTimer, host.g.heliTimer);
});

test('a helicopter leaving is announced too', () => {
  const { host, guest, hs, gs } = liveMatch();
  const airborne = routeHeli(host.g, { x: 900, speed: 400, legsTotal: 1 });   // out of legs: the edge retires it
  host.g.heli = host.g.heliIn(airborne);
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

  guest.advanceUntil(() => guest.g.heli === null, { maxMs: 12000 });

  // It used to fall through the terrain and off the bottom of the screen,
  // still airborne, until an announcement happened to remove it.
  assert.equal(guest.g.heli, null, 'it lands here rather than falling for ever');
  assert.ok(guest.g.explosions.length > 0 || guest.g.particles.length > 0,
    'and makes a mess doing it');

  // What the wreck *did* is decided by the owner and arrives in a snapshot —
  // working the blast out locally gave the two clients different answers.
  const authoritative = host.g.netSnapshot();
  authoritative.terrain[500] += 40;
  guest.g.netApplyState(JSON.parse(JSON.stringify(authoritative)));
  assert.equal(Math.round(guest.g.groundHeightAt(500)),
    Math.round(authoritative.terrain[500]), 'the crater comes from the owner');
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

  assert.equal(guest.g.tanks[0].alive, true,
    'we do not work the blast out ourselves — the owner says what it did');
  assert.equal(guest.g.tanks[0].hp, 5, 'so no damage is invented here');
  assert.equal(guest.g.currentPlayer, 0,
    'nor do we advance the turn — that would move play twice');
  assert.ok(guest.g.explosions.length > 0, 'but the wreck is still drawn');
});

test('a helicopter turns at the edge on every screen at once, without a message', () => {
  const { host, guest, hs } = liveMatch();
  // One leg in, about to leave by the right-hand edge.
  const outbound = routeHeli(host.g, { x: host.g.W + host.g.heliSize() * 1.4, y: 140, speed: 300, seen: [0] });
  host.g.heli = host.g.heliIn(outbound);
  guest.g.heli = guest.g.heliIn(outbound);
  host.advance(16);
  guest.advance(16);
  const said = hs.payloads('heli').length;

  host.advance(500);
  guest.advance(500);
  for (const c of [host, guest]) {
    assert.ok(c.g.heli, 'still flying');
    assert.equal(c.g.heli.dir, -1, 'and heading back');
    assert.equal(c.g.heli.legs, 1);
  }
  assert.deepEqual({ ...guest.g.heliDrawPos() }, { ...host.g.heliDrawPos() }, 'in the same place, at the same altitude');
  assert.equal(hs.payloads('heli').length, said, 'a turnaround is part of the route, not news');
});

test('any discrete change is announced, and flying along is not', () => {
  const { host, hs } = liveMatch();
  const said = () => hs.payloads('heli').length;

  // Arriving.
  host.g.heli = null;
  host.g.state = 'AIMING';
  assert.ok(host.advanceUntil(() => host.g.heli !== null, { maxMs: 200000 }));
  const afterArrival = said();
  assert.ok(afterArrival > 0, 'arrival');

  // Flying along, through a turnaround: the route already says all of it.
  host.g.heli.t0 -= (host.g.W + host.g.heliSize() * 2.3) / host.g.heli.speed;
  const heading = host.g.heli.dir;
  host.advance(3000);
  assert.notEqual(host.g.heli.dir, heading, 'it turned');
  assert.equal(said(), afterArrival, 'without a word');

  // Being told how many legs it has left.
  host.g.heli.legsTotal = 3;
  host.advance(100);
  assert.ok(said() > afterArrival, 'its last leg decided');
  const afterLegs = said();

  // Starting to fall.
  host.g.heli.falling = true;
  host.g.heli.vy = 10;
  host.g.heli.t = host.g.netNow();
  host.advance(100);
  assert.ok(said() > afterLegs, 'beginning to come down');
});

test('a crash that ends the round is announced, including to the winner', () => {
  const { host, guest, hs, gs } = liveMatch();
  for (const c of [host, guest]) { c.flatTerrain(400); c.placeTanksAt([150, 850]); }
  host.g.currentPlayer = 0;         // the host holds the turn, so owns the wreck
  host.g.state = 'AIMING';
  guest.g.state = 'AIMING';
  host.g.tanks[0].hp = 3;           // and is about to be flattened by it

  host.g.heliCrash(150, host.g.groundHeightAt(150));

  assert.equal(host.g.state, 'GAMEOVER', 'the round is over here');
  const sync = hs.payloads('sync').slice(-1)[0];
  assert.ok(sync, 'and a crash that ends the round still publishes');
  assert.equal(sync.state.state, 'GAMEOVER');
  assert.equal(sync.state.winner, 1, 'naming the survivor');

  // The winner is seat 1 — the client that did NOT own the crash, and so would
  // otherwise have sat there playing on, never told it had won.
  gs.deliver({ t: 'msg', from: 1, d: sync });
  assert.equal(guest.g.state, 'GAMEOVER');
  assert.ok(guest.g.el.overlay.classList.contains('show'), 'the winner is shown the result');
});

test('the two sides cannot disagree about whether a tank survived', () => {
  const { host, guest, hs, gs } = liveMatch();
  for (const c of [host, guest]) { c.flatTerrain(400); c.placeTanksAt([150, 850]); }
  host.g.currentPlayer = 0;
  host.g.state = 'AIMING';
  guest.g.state = 'AIMING';
  host.g.tanks[1].hp = 1;
  guest.g.tanks[1].hp = 1;

  // The same crash, but each client's own copy of the aircraft sits a little
  // differently — which used to leave one on 1 hp and the other dead.
  host.g.heliCrash(820, host.g.groundHeightAt(820));
  guest.g.heliCrash(828, guest.g.groundHeightAt(828));

  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('sync').slice(-1)[0] });
  assert.equal(guest.g.tanks[1].hp, host.g.tanks[1].hp, 'one answer, not two');
  assert.equal(guest.g.tanks[1].alive, host.g.tanks[1].alive);
  assert.equal(guest.g.state, host.g.state, 'and one view of whether it is over');
});

test('a wreck that has crashed here is not put back in the sky by late news', () => {
  const { guest, gs } = liveMatch();
  guest.flatTerrain(400);
  guest.placeTanksAt([150, 850]);
  const falling = {
    id: 7, x: 500, y: 200, dir: 1, speed: 60, vy: 120,
    falling: true, spin: 0, legs: 1, seen: [0, 1]
  };
  gs.deliver({ t: 'msg', from: 1, d: { k: 'heli', heli: falling, heliTimer: 90 } });
  assert.ok(guest.advanceUntil(() => guest.g.heli === null, { maxMs: 12000 }), 'it crashes here');

  // The shooter's screen was behind this one, so its word that the wreck is
  // falling — and a snapshot taken while it was — arrive after the crash.
  gs.deliver({ t: 'msg', from: 1, d: { k: 'heli', heli: falling, heliTimer: 90 } });
  assert.equal(guest.g.heli, null, 'the falling wreck is not brought back');
  const snap = guest.g.netSnapshot();
  snap.heli = falling;
  guest.g.netApplyState(JSON.parse(JSON.stringify(snap)));
  assert.equal(guest.g.heli, null, 'nor by a snapshot of it mid-fall');

  // A different helicopter is a different matter.
  const next = routeHeli(guest.g, { id: 8, x: 500 });
  gs.deliver({ t: 'msg', from: 1, d: { k: 'heli', heli: next, heliTimer: 90 } });
  assert.equal(guest.g.heli && guest.g.heli.id, 8, 'the next one still arrives');
});
