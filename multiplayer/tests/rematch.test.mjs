// Restarting a match, and surviving someone leaving. Both are about the same
// thing: a match must never end up with the two players on different boards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

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

/** A live two-seat match: returns both clients and their sockets. */
function liveMatch() {
  const host = load(), guest = load();
  const hs = connect(host), gs = connect(guest, 'ABCD');
  hs.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  gs.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  hs.deliver({ t: 'peer', id: 2, name: '' });
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  return { host, guest, hs, gs };
}

const terrainOf = (h) => Array.from(h.g.terrain);

test('the host restarting deals the same new board to both', () => {
  const { host, guest, hs, gs } = liveMatch();
  assert.deepEqual(terrainOf(guest), terrainOf(host), 'same board to begin with');
  const before = terrainOf(host);

  host.g.el.restartBtn.dispatch('click');

  const starts = hs.payloads('start');
  assert.equal(starts.length, 2, 'a second start goes out');
  gs.deliver({ t: 'msg', from: 1, d: starts[1] });

  assert.notDeepEqual(terrainOf(host), before, 'the terrain actually changed');
  assert.deepEqual(terrainOf(guest), terrainOf(host), 'and both players got the same one');
  assert.equal(guest.g.online.status, 'playing');
});

test('a guest asking for a rematch goes through the host, not around it', () => {
  const { host, guest, hs, gs } = liveMatch();
  const guestBoardBefore = terrainOf(guest);

  guest.g.el.restartBtn.dispatch('click');

  // The guest must not reroll its own terrain — that is the desync.
  assert.deepEqual(terrainOf(guest), guestBoardBefore, 'the guest board is untouched');
  assert.deepEqual(gs.payloads('rematch'), [{ k: 'rematch' }], 'it asks instead');

  hs.deliver({ t: 'msg', from: 2, d: { k: 'rematch' } });
  const starts = hs.payloads('start');
  assert.equal(starts.length, 2, 'the host deals it');
  gs.deliver({ t: 'msg', from: 1, d: starts[1] });
  assert.deepEqual(terrainOf(guest), terrainOf(host), 'and now they match');
});

test('offline, Play Again still just restarts', () => {
  const h = load();
  const before = Array.from(h.g.terrain);
  h.g.el.restartBtn.dispatch('click');
  assert.notDeepEqual(Array.from(h.g.terrain), before);
  assert.equal(h.g.online.status, 'offline');
});

test('someone leaving hands on the host role and keeps their seat open', () => {
  const { guest, gs } = liveMatch();
  assert.equal(guest.g.online.host, false, 'the guest was not host');

  gs.deliver({ t: 'gone', id: 1, host: 2 });

  assert.equal(guest.g.online.host, true, 'the relay handed the role on and we took it');
  assert.equal(guest.g.online.vacant, 0, 'seat 0 is being kept open');
  assert.equal(guest.g.online.status, 'ended');
});

test('a rejoin resumes the board in progress rather than starting over', () => {
  const { host, guest, hs, gs } = liveMatch();

  // Give the board some history so "resumed" is distinguishable from "new".
  host.g.craterAt(400, host.g.groundHeightAt(400), 44);
  host.g.tanks[1].hp = 48;
  gs.deliver({ t: 'msg', from: 1, d: { k: 'sync', state: host.g.netSnapshot() } });
  const midMatch = terrainOf(guest);
  assert.equal(guest.g.tanks[1].hp, 48);

  // The host drops, then someone joins the room again.
  gs.deliver({ t: 'gone', id: 1, host: 2 });
  gs.deliver({ t: 'peer', id: 3, name: '' });

  const starts = gs.payloads('start');
  assert.equal(starts.length, 1, 'the remaining player deals them in');
  assert.deepEqual(starts[0].seats, [3, 2], 'the newcomer takes the empty seat');
  assert.deepEqual(Array.from(starts[0].state.terrain), midMatch,
    'and is handed the board as it stands, craters and all');
  assert.equal(starts[0].state.tanks[1].hp, 48, 'damage is not undone');
  assert.equal(guest.g.online.status, 'playing');
  assert.equal(guest.g.online.vacant, null);
});

test('the rejoining player lands on that board, in that seat', () => {
  const { host, guest, hs, gs } = liveMatch();
  host.g.craterAt(400, host.g.groundHeightAt(400), 44);
  gs.deliver({ t: 'msg', from: 1, d: { k: 'sync', state: host.g.netSnapshot() } });
  gs.deliver({ t: 'gone', id: 1, host: 2 });
  gs.deliver({ t: 'peer', id: 3, name: '' });

  const rejoiner = load();
  const rs = connect(rejoiner, 'ABCD');
  rs.deliver({ t: 'joined', room: 'ABCD', id: 3, host: 2, peers: [{ id: 2, name: '' }] });
  rs.deliver({ t: 'msg', from: 2, d: gs.payloads('start')[0] });

  assert.equal(rejoiner.g.online.seat, 0, 'takes the seat that was left empty');
  assert.equal(rejoiner.g.online.status, 'playing');
  assert.deepEqual(terrainOf(rejoiner), terrainOf(guest), 'on the same board');
});

test('a rematch is refused while a seat is still empty', () => {
  const { guest, gs } = liveMatch();
  gs.deliver({ t: 'gone', id: 1, host: 2 });
  const before = gs.payloads('start').length;

  guest.g.el.restartBtn.dispatch('click');

  assert.equal(gs.payloads('start').length, before,
    'nothing is dealt to a board with nobody on the other side');
});
