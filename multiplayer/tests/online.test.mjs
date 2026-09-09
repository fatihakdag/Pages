// The online layer: joining a room, dealing seats, and keeping two clients
// holding the same battlefield. The relay itself is tested in ../server; here
// the socket is faked, so these are about what the *game* does with the
// protocol rather than about sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadFlat } from './harness.mjs';

/** A stand-in for WebSocket that records what was sent and can be fed frames. */
function fakeSocket() {
  const listeners = {};
  const sock = {
    readyState: 1,
    sent: [],
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    send(text) { sock.sent.push(JSON.parse(text)); },
    close() { sock.readyState = 3; (listeners.close || []).forEach(fn => fn()); },
    emit(type, ev) { (listeners[type] || []).forEach(fn => fn(ev)); },
    /** Deliver a relay frame to the game. */
    deliver(obj) { sock.emit('message', { data: JSON.stringify(obj) }); },
    /** Messages the game sent inside `msg` envelopes. */
    payloads(kind) {
      return sock.sent.filter(m => m.t === 'msg' && (!kind || m.d.k === kind)).map(m => m.d);
    }
  };
  return sock;
}

/** Connect a game to a fake relay and open the socket. */
function connect(h, { room = null } = {}) {
  const sock = fakeSocket();
  h.g.setSocketFactory(() => sock);
  h.g.netConnect(room);
  sock.emit('open');
  return sock;
}

/** Drive a client all the way to a live two-seat match. */
function hostAMatch(h) {
  const sock = connect(h);
  sock.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  sock.deliver({ t: 'peer', id: 2, name: '' });
  return sock;
}

function joinAMatch(h) {
  const sock = connect(h, { room: 'ABCD' });
  sock.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  return sock;
}

test('hosting asks the relay for a new room', () => {
  const h = load();
  const sock = connect(h);
  assert.deepEqual(sock.sent[0], { t: 'join', v: h.g.NET_PROTOCOL });
  assert.equal(h.g.online.status, 'connecting');

  sock.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  assert.equal(h.g.online.status, 'waiting');
  assert.equal(h.g.online.room, 'ABCD');
  assert.equal(h.g.online.host, true);
  assert.match(h.g.el2.onlineStatus.textContent, /ABCD/, 'the code is shown so it can be shared');
});

test('joining names the room and announces us to the host', () => {
  const h = load();
  const sock = connect(h, { room: 'WXYZ' });
  assert.deepEqual(sock.sent[0], { t: 'join', v: h.g.NET_PROTOCOL, room: 'WXYZ' });

  sock.deliver({ t: 'joined', room: 'WXYZ', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  assert.equal(h.g.online.host, false);
  // The host is waiting to be told someone is ready before dealing seats.
  assert.equal(sock.payloads('ready').length, 1);
});

test('the host deals seats and hands out the world when someone arrives', () => {
  const h = load();
  const sock = hostAMatch(h);

  const [start] = sock.payloads('start');
  assert.ok(start, 'a start message goes out');
  assert.deepEqual(start.seats, [1, 2], 'join order is seat order');
  assert.equal(h.g.online.seat, 0, 'the host takes seat 0');
  assert.equal(h.g.online.status, 'playing');

  // The world travels with it, so both sides play the same terrain.
  assert.equal(start.state.terrain.length, h.g.W);
  assert.equal(start.state.tanks.length, 2);
  assert.equal(h.g.cpuMode, false, 'a match is never against the CPU');
});

test('a guest adopts the seat and the world it is given', () => {
  const host = load();
  const hostSock = hostAMatch(host);
  const [start] = hostSock.payloads('start');

  const guest = load({ width: 390, height: 844 }); // deliberately a different screen
  const guestSock = joinAMatch(guest);
  guestSock.deliver({ t: 'msg', from: 1, d: start });

  assert.equal(guest.g.online.seat, 1, 'the guest drives seat 1');
  assert.equal(guest.g.online.status, 'playing');
  assert.deepEqual(
    Array.from(guest.g.terrain), Array.from(host.g.terrain),
    'both clients hold the same terrain despite different screens'
  );
  assert.deepEqual(
    Array.from(guest.g.tanks, t => t.x), Array.from(host.g.tanks, t => t.x)
  );
  assert.equal(guest.g.wind, host.g.wind);
});

test('the seat we do not drive is locked, exactly like a CPU seat', () => {
  const h = load();
  hostAMatch(h);

  h.g.currentPlayer = 0; // ours
  h.g.state = 'AIMING';
  h.g.syncControlsFromTank();
  assert.equal(h.g.el.fireBtn.disabled, false);
  assert.equal(h.g.el.angleSlider.disabled, false);

  h.g.currentPlayer = 1; // theirs
  h.g.syncControlsFromTank();
  assert.equal(h.g.el.fireBtn.disabled, true, 'we cannot fire on their turn');
  assert.equal(h.g.el.angleSlider.disabled, true);
  assert.equal(h.g.el.weaponSelect.disabled, true, 'nor change what they are about to fire');
});

test('firing publishes the inputs before the shell is simulated', () => {
  const h = loadFlat();
  const sock = hostAMatch(h);
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  h.g.currentPlayer = 0;
  h.g.tanks[0].angle = 40;
  h.g.tanks[0].power = 70;
  h.g.tanks[0].weapon = 'standard';
  h.g.state = 'AIMING';

  h.g.fire();

  const [turn] = sock.payloads('turn');
  assert.deepEqual(turn, { k: 'turn', seat: 0, angle: 40, power: 70, weapon: 'standard' });
});

test('their turn is replayed here, not merely reported', () => {
  const h = loadFlat();
  const sock = joinAMatch(h);
  const host = loadFlat();
  const hostSock = hostAMatch(host);
  sock.deliver({ t: 'msg', from: 1, d: hostSock.payloads('start')[0] });

  h.flatTerrain(400);
  h.g.state = 'AIMING';
  sock.deliver({ t: 'msg', from: 1, d: { k: 'turn', seat: 0, angle: 45, power: 60, weapon: 'big' } });

  assert.equal(h.g.state, 'FIRING', 'the shot is flying here too');
  assert.equal(h.g.projectiles.length, 1);
  assert.equal(h.g.projectiles[0].weapon, 'big');
  assert.equal(h.g.tanks[0].angle, 45, 'their aim is mirrored so the barrel matches');
});

test('a sync that lands mid-flight waits for the shot to finish', () => {
  const h = loadFlat();
  const sock = joinAMatch(h);
  const host = loadFlat();
  const hostSock = hostAMatch(host);
  sock.deliver({ t: 'msg', from: 1, d: hostSock.payloads('start')[0] });

  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  h.g.state = 'AIMING';
  h.g.currentPlayer = 0;
  h.g.fire();
  assert.equal(h.g.state, 'FIRING');

  // Authority arrives while the shell is still in the air.
  const authoritative = h.g.netSnapshot();
  authoritative.tanks[1].hp = 42;
  sock.deliver({ t: 'msg', from: 1, d: { k: 'sync', state: authoritative } });

  assert.equal(h.g.tanks[1].hp, 100, 'the flight is not cut short by the snap');
  assert.equal(h.g.online.pendingSync !== null, true, 'it is held instead');

  h.advanceUntil(() => h.g.state === 'AIMING' || h.g.state === 'GAMEOVER');
  assert.equal(h.g.tanks[1].hp, 42, 'and applied once the turn resolves');
  assert.equal(h.g.online.pendingSync, null);
});

test('a snapshot survives the round trip, unlimited ammo included', () => {
  const h = loadFlat();
  hostAMatch(h);
  h.g.tanks[0].hp = 61;
  h.g.tanks[1].alive = false;
  h.g.tanks[0].ammo.big = 2;
  h.g.wind = -37;
  h.g.craterAt(400, h.g.groundHeightAt(400), 40);

  const snap = JSON.parse(JSON.stringify(h.g.netSnapshot())); // as it travels
  const before = Array.from(h.g.terrain);

  const other = loadFlat();
  hostAMatch(other);
  other.g.netApplyState(snap);

  assert.deepEqual(Array.from(other.g.terrain), before, 'craters travel');
  assert.equal(other.g.tanks[0].hp, 61);
  assert.equal(other.g.tanks[1].alive, false);
  assert.equal(other.g.tanks[0].ammo.big, 2);
  assert.equal(other.g.wind, -37, 'wind is the sender’s roll, not a fresh one');
  assert.equal(other.g.tanks[0].ammo.standard, Infinity,
    'the standard shell is unlimited, which JSON cannot carry directly');
});

test('finishing our turn publishes the result', () => {
  const h = loadFlat();
  const sock = hostAMatch(h);
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  h.g.currentPlayer = 0;
  h.g.tanks[0].angle = 45;
  h.g.tanks[0].power = 60;
  h.g.state = 'AIMING';

  h.fireAndSettle();
  const syncs = sock.payloads('sync');
  assert.equal(syncs.length, 1, 'exactly one result per turn');
  assert.equal(syncs[0].state.currentPlayer, 1, 'and it says whose turn it now is');
});

test('a refused join is reported rather than left hanging', () => {
  const h = load();
  const sock = connect(h, { room: 'ZZZZ' });
  sock.deliver({ t: 'err', code: 'NO_ROOM', msg: 'no room ZZZZ' });

  assert.equal(h.g.online.status, 'offline');
  assert.equal(h.g.el2.onlineStatus.textContent, h.g.txt('netNoRoom'));
  assert.equal(h.g.el2.onlineHostBtn.disabled, false, 'and we can try again');
});

test('a client on the wrong protocol is told to update, not silently desynced', () => {
  const h = load();
  const sock = connect(h);
  sock.deliver({ t: 'err', code: 'BAD_VERSION', msg: 'relay speaks protocol 9' });
  assert.equal(h.g.el2.onlineStatus.textContent, h.g.txt('netVersion'));
});

test('an opponent leaving ends the match and hands the controls back', () => {
  const h = load();
  const sock = hostAMatch(h);
  assert.equal(h.g.online.status, 'playing');

  sock.deliver({ t: 'gone', id: 2, host: 1 });

  assert.equal(h.g.online.status, 'ended');
  assert.equal(h.g.el2.onlineStatus.textContent, h.g.txt('netEnded'));
  h.g.currentPlayer = 1;
  h.g.state = 'AIMING';
  h.g.syncControlsFromTank();
  assert.equal(h.g.el.angleSlider.disabled, false, 'the seat is no longer somebody else’s');
});

test('a dropped connection is reported', () => {
  const h = load();
  const sock = connect(h);
  sock.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  sock.close();
  assert.equal(h.g.online.status, 'offline');
  assert.equal(h.g.el2.onlineStatus.textContent, h.g.txt('netLost'));
});

test('every online string has a Turkish counterpart', () => {
  const h = load();
  const keys = ['online', 'hostGame', 'joinGame', 'netOffline', 'netConnecting',
    'netWaiting', 'netPlaying', 'netEnded', 'netNoRoom', 'netFull',
    'netVersion', 'netLost'];
  h.g.el.langCheckbox.checked = true;
  h.g.el.langCheckbox.dispatch('change');
  for (const k of keys) {
    assert.notEqual(h.g.txt(k), k, `${k} falls through to the key in Turkish`);
  }
});
