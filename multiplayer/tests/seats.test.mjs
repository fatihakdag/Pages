// Three and four seat matches, and what the controls say while one is running.
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

/** A host that has opened a room for `seats` players. */
function hostFor(seats) {
  const h = load();
  h.g.el.countSelect.value = String(seats);
  const s = connect(h);
  s.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  return { h, s };
}

test('a two-seat room deals as soon as the second player arrives', () => {
  const { h, s } = hostFor(2);
  s.deliver({ t: 'peer', id: 2, name: '' });
  const [start] = s.payloads('start');
  assert.ok(start, 'dealt');
  assert.deepEqual(start.seats, [1, 2]);
  assert.equal(h.g.playerCount, 2);
});

test('a four-seat room waits for the whole table', () => {
  const { h, s } = hostFor(4);

  s.deliver({ t: 'peer', id: 2, name: '' });
  assert.deepEqual(s.payloads('start'), [], 'two is not a table of four');
  assert.match(h.g.el2.onlineStatus.textContent, /2\/4/, 'and the lobby says how many are here');

  s.deliver({ t: 'peer', id: 3, name: '' });
  assert.deepEqual(s.payloads('start'), [], 'nor is three');
  assert.match(h.g.el2.onlineStatus.textContent, /3\/4/);

  s.deliver({ t: 'peer', id: 4, name: '' });
  const [start] = s.payloads('start');
  assert.ok(start, 'the fourth starts it');
  assert.deepEqual(start.seats, [1, 2, 3, 4], 'seats in join order');
  assert.equal(h.g.playerCount, 4);
  assert.equal(h.g.tanks.length, 4, 'four tanks on the field');
  assert.equal(start.state.tanks.length, 4, 'and four in the world everyone gets');
});

test('a three-seat game deals three', () => {
  const { h, s } = hostFor(3);
  s.deliver({ t: 'peer', id: 2, name: '' });
  s.deliver({ t: 'peer', id: 3, name: '' });
  const [start] = s.payloads('start');
  assert.deepEqual(start.seats, [1, 2, 3]);
  assert.equal(h.g.tanks.length, 3);
});

test('a guest takes the seat it was dealt, whatever the table size', () => {
  const { s: hs } = hostFor(4);
  [2, 3, 4].forEach(id => hs.deliver({ t: 'peer', id, name: '' }));
  const [start] = hs.payloads('start');

  const third = load();
  const ts = connect(third, 'ABCD');
  ts.deliver({ t: 'joined', room: 'ABCD', id: 3, host: 1, peers: [{ id: 1 }, { id: 2 }] });
  ts.deliver({ t: 'msg', from: 1, d: start });

  assert.equal(third.g.online.seat, 2, 'third to join takes seat 2');
  assert.equal(third.g.playerCount, 4);
  assert.equal(third.g.tanks.length, 4);
  assert.equal(third.g.el.countSelect.value, '4', 'the roster control follows the match');
});

test('someone left over when the table filled is told, not left hanging', () => {
  const { s: hs } = hostFor(2);
  hs.deliver({ t: 'peer', id: 2, name: '' });
  const [start] = hs.payloads('start');   // seats [1,2]

  const spare = load();
  const ss = connect(spare, 'ABCD');
  ss.deliver({ t: 'joined', room: 'ABCD', id: 5, host: 1, peers: [{ id: 1 }, { id: 2 }] });
  ss.deliver({ t: 'msg', from: 1, d: start });

  assert.equal(spare.g.online.seat, -1, 'not seated');
  assert.equal(spare.g.online.status, 'ended');
  assert.equal(spare.g.el2.onlineStatus.textContent, spare.g.txt('netFull'));
});

test('the opponents control reads Online during a match, and locks', () => {
  const { h, s } = hostFor(2);
  const mode = h.g.el.modeSelect;
  const onlineOpt = mode.options.find(o => o.value === 'online');
  assert.equal(onlineOpt.hidden, true, 'hidden while there is no match');

  s.deliver({ t: 'peer', id: 2, name: '' });

  assert.equal(mode.value, 'online', 'it no longer claims to be vs CPU');
  assert.equal(onlineOpt.hidden, false);
  h.g.syncControlsFromTank();
  assert.equal(mode.disabled, true, 'and the roster cannot be changed mid-match');
  assert.equal(h.g.el.countSelect.disabled, true);
  assert.equal(h.g.el.difficultySelect.disabled, true);
});

test('the roster comes back when the match ends', () => {
  const { h, s } = hostFor(2);
  s.deliver({ t: 'peer', id: 2, name: '' });
  assert.equal(h.g.el.modeSelect.value, 'online');

  s.deliver({ t: 'gone', id: 2, host: 1 });
  h.g.refreshOpponentUi();
  h.g.syncControlsFromTank();

  assert.notEqual(h.g.el.modeSelect.value, 'online', 'back to a real mode');
  assert.equal(h.g.el.modeSelect.options.find(o => o.value === 'online').hidden, true);
  assert.equal(h.g.el.countSelect.disabled, false, 'and editable again');
});

test('turns go round the whole table, not just two seats', () => {
  const { h, s } = hostFor(4);
  [2, 3, 4].forEach(id => s.deliver({ t: 'peer', id, name: '' }));
  h.flatTerrain(400);
  h.placeTanksAt([150, 380, 620, 850]);

  const seen = [h.g.currentPlayer];
  for (let i = 0; i < 3; i++) {
    h.g.state = 'AIMING';
    h.g.currentPlayer = seen[seen.length - 1];
    h.g.tanks[h.g.currentPlayer].angle = 45;
    h.g.tanks[h.g.currentPlayer].power = 30;   // short, so nobody dies
    h.fireAndSettle();
    seen.push(h.g.currentPlayer);
  }
  assert.deepEqual(seen, [0, 1, 2, 3], 'each seat gets a turn in order');
});
