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

/** A member arriving: the relay's notice, then its own hello with a token. */
function arrive(sock, id, token) {
  sock.deliver({ t: 'peer', id, name: '' });
  sock.deliver({ t: 'msg', from: id, d: { k: 'ready', token: token || ('tok' + id) } });
}

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
  arrive(s, 2);
  const [start] = s.payloads('start');
  assert.ok(start, 'dealt');
  assert.deepEqual(start.seats, [1, 2]);
  assert.equal(h.g.playerCount, 2);
});

test('a four-seat room waits for the whole table', () => {
  const { h, s } = hostFor(4);

  arrive(s, 2);
  assert.deepEqual(s.payloads('start'), [], 'two is not a table of four');
  assert.match(h.g.el2.onlineStatus.textContent, /2\/4/, 'and the lobby says how many are here');

  arrive(s, 3);
  assert.deepEqual(s.payloads('start'), [], 'nor is three');
  assert.match(h.g.el2.onlineStatus.textContent, /3\/4/);

  arrive(s, 4);
  const [start] = s.payloads('start');
  assert.ok(start, 'the fourth starts it');
  assert.deepEqual(start.seats, [1, 2, 3, 4], 'seats in join order');
  assert.equal(h.g.playerCount, 4);
  assert.equal(h.g.tanks.length, 4, 'four tanks on the field');
  assert.equal(start.state.tanks.length, 4, 'and four in the world everyone gets');
});

test('a three-seat game deals three', () => {
  const { h, s } = hostFor(3);
  arrive(s, 2);
  arrive(s, 3);
  const [start] = s.payloads('start');
  assert.deepEqual(start.seats, [1, 2, 3]);
  assert.equal(h.g.tanks.length, 3);
});

test('a guest takes the seat it was dealt, whatever the table size', () => {
  const { s: hs } = hostFor(4);
  [2, 3, 4].forEach(id => arrive(hs, id));
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
  arrive(hs, 2);
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

  arrive(s, 2);

  assert.equal(mode.value, 'online', 'it no longer claims to be vs CPU');
  assert.equal(onlineOpt.hidden, false);
  h.g.syncControlsFromTank();
  assert.equal(mode.disabled, true, 'and the roster cannot be changed mid-match');
  assert.equal(h.g.el.countSelect.disabled, true);
  assert.equal(h.g.el.difficultySelect.disabled, true);
});

test('the roster stays locked while a match is still running', () => {
  const { h, s } = hostFor(2);
  arrive(s, 2);
  assert.equal(h.g.el.modeSelect.value, 'online');

  // Someone dropping does not end the match, so the roster is still not ours
  // to edit — their seat is being held and the CPU may be about to play it.
  s.deliver({ t: 'gone', id: 2, host: 1 });
  h.g.refreshOpponentUi();
  h.g.syncControlsFromTank();
  assert.equal(h.g.el.modeSelect.value, 'online');
  assert.equal(h.g.el.countSelect.disabled, true);

  // Everyone gone is a different matter: there is no match left.
  h.g.online.seats = [null, null];
  s.deliver({ t: 'gone', id: 1, host: null });
  h.g.refreshOpponentUi();
  h.g.syncControlsFromTank();
  assert.notEqual(h.g.el.modeSelect.value, 'online', 'back to a real mode');
  assert.equal(h.g.el.countSelect.disabled, false, 'and editable again');
});

test('turns go round the whole table, not just two seats', () => {
  const { h, s } = hostFor(4);
  [2, 3, 4].forEach(id => arrive(s, id));
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

test('two empty seats are both remembered, not just the last one', () => {
  const { h, s } = hostFor(4);
  [2, 3, 4].forEach(id => arrive(s, id));

  s.deliver({ t: 'gone', id: 2, host: 1 });
  s.deliver({ t: 'gone', id: 3, host: 1 });

  // Tracking a single seat orphaned the earlier one for good: nobody could
  // ever fill it, and its tank sat there played by nothing.
  assert.deepEqual(Array.from(h.g.online.vacancies), [1, 2], 'both chairs are kept');
});

test('a returning player gets their own seat back, not just any free one', () => {
  const { h, s } = hostFor(4);
  arrive(s, 2, 'ada');
  arrive(s, 3, 'bo');
  arrive(s, 4, 'cy');
  assert.deepEqual(Array.from(h.g.online.seats), [1, 2, 3, 4]);

  // Ada (seat 1) and Bo (seat 2) both drop; Bo comes back first.
  s.deliver({ t: 'gone', id: 2, host: 1 });
  s.deliver({ t: 'gone', id: 3, host: 1 });
  arrive(s, 7, 'bo');

  const dealt = s.payloads('start').slice(-1)[0];
  assert.equal(dealt.seats[2], 7, 'Bo is back in seat 2, the one Bo had');
  assert.equal(dealt.seats[1], null, "and Ada's seat is still waiting for Ada");
  assert.deepEqual(Array.from(h.g.online.vacancies), [1]);

  // Then Ada returns to hers.
  arrive(s, 8, 'ada');
  const after = s.payloads('start').slice(-1)[0];
  assert.deepEqual(after.seats, [1, 8, 7, 4], 'everyone is where they were');
  assert.equal(h.g.online.vacancies.length, 0);
});

test('a stranger with the code is refused, not given somebody else’s tank', () => {
  const { h, s } = hostFor(4);
  [2, 3, 4].forEach(id => arrive(s, id));
  s.deliver({ t: 'gone', id: 3, host: 1 });
  s.deliver({ t: 'gone', id: 2, host: 1 });
  const dealtBefore = s.payloads('start').length;

  arrive(s, 9, 'nobody-we-know');

  assert.equal(s.payloads('start').length, dealtBefore, 'nobody is seated');
  assert.deepEqual(s.payloads('denied'), [{ k: 'denied', to: 9, reason: 'full' }],
    'they are told the room is full');
  assert.deepEqual(Array.from(h.g.online.vacancies), [2, 1],
    'and both chairs stay with their owners');
});

test('a refused client is told, and stops trying to get back in', () => {
  const h = load();
  const s = connect(h, 'ABCD');
  s.deliver({ t: 'joined', room: 'ABCD', id: 9, host: 1, peers: [{ id: 1 }] });
  h.g.online.rejoin = { code: 'ABCD', tries: 2 };

  s.deliver({ t: 'msg', from: 1, d: { k: 'denied', to: 9, reason: 'full' } });

  assert.equal(h.g.online.status, 'ended');
  assert.equal(h.g.el2.onlineStatus.textContent, h.g.txt('netFull'));
  assert.equal(h.g.online.rejoin, null, 'no point retrying a match we are not in');
});

test('a returning player takes their seat back from the stand-in CPU', () => {
  const { h, s } = hostFor(2);
  arrive(s, 2, 'bo');
  const boSeat = h.g.online.seats.indexOf(2);
  s.deliver({ t: 'gone', id: 2, host: 1 });
  h.g.online.aiSeats.push(boSeat);      // they were away long enough for the CPU
  h.g.online.missed[boSeat] = 2;

  arrive(s, 6, 'bo');

  assert.equal(h.g.netSeatIsAi(boSeat), false, 'the CPU stands down at once');
  assert.equal(h.g.online.missed[boSeat], 0, 'and the count starts over');
  assert.equal(s.payloads('start').slice(-1)[0].seats[boSeat], 6);
});

test('a seat token survives a reload, because it is not held in memory', () => {
  const { h, s } = hostFor(2);
  arrive(s, 2);
  const mine = h.g.online.token;
  assert.ok(mine, 'we have one');
  // netToken is what a reloaded page calls on rejoining the same room.
  assert.equal(h.g.netToken(h.g.online.room), mine, 'and it is the same one');
  assert.notEqual(h.g.netToken('OTHER'), mine, 'but not shared between rooms');
});
