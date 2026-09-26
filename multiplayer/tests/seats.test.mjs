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
  h.g.el2.onlineSeatsSelect.value = String(seats);
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

test('a six-seat room waits for all six', () => {
  const { h, s } = hostFor(6);

  [2, 3, 4, 5].forEach(id => arrive(s, id));
  assert.deepEqual(s.payloads('start'), [], 'five is not a table of six');
  assert.match(h.g.el2.onlineStatus.textContent, /5\/6/);

  arrive(s, 6);
  const [start] = s.payloads('start');
  assert.ok(start, 'the sixth starts it');
  assert.deepEqual(start.seats, [1, 2, 3, 4, 5, 6], 'seats in join order');
  assert.equal(h.g.tanks.length, 6, 'six tanks on the field');
  assert.equal(start.state.tanks.length, 6, 'and six in the world everyone gets');
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
  assert.deepEqual(s.payloads('denied'), [{ k: 'denied', round: 1, to: 9, reason: 'full' }],
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

test('seats do not change hands mid-match', () => {
  const { h, s } = hostFor(2);
  arrive(s, 2, 'bo');
  assert.equal(h.g.online.seat, 0);
  const before = Array.from(h.g.online.seats);

  // A rematch keeps them.
  h.g.el.restartBtn.dispatch('click');
  assert.deepEqual(Array.from(h.g.online.seats), before, 'a rematch is the same table');
  assert.equal(h.g.online.seat, 0);

  // So does someone dropping and returning.
  s.deliver({ t: 'gone', id: 2, host: 1 });
  arrive(s, 6, 'bo');
  assert.equal(h.g.online.seat, 0, 'ours is untouched');
  assert.equal(s.payloads('start').slice(-1)[0].seats[1], 6, 'and theirs is theirs');
});

test('everyone dropping and returning in another order keeps their seats', () => {
  // Two clients, a real match, then both connections die and they come back the
  // other way round. Dealing purely in join order made whoever reconnected
  // first seat 0, so the players swapped tanks and colours with no explanation.
  const A = load(), B = load();
  let as_ = connect(A), bs = connect(B, 'ABCD');
  as_.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  bs.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  as_.deliver({ t: 'peer', id: 2, name: '' });
  as_.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: B.g.online.token } });
  bs.deliver({ t: 'msg', from: 1, d: as_.payloads('start')[0] });
  assert.equal(A.g.online.seat, 0);
  assert.equal(B.g.online.seat, 1);

  as_.close();
  bs.close();

  // B is back first, so the relay makes B host of the room it still holds.
  const bs2 = connect(B, 'ABCD');
  bs2.deliver({ t: 'joined', room: 'ABCD', id: 7, host: 7, peers: [] });
  const as2 = connect(A, 'ABCD');
  as2.deliver({ t: 'joined', room: 'ABCD', id: 8, host: 7, peers: [{ id: 7, name: '' }] });
  bs2.deliver({ t: 'peer', id: 8, name: '' });
  bs2.deliver({ t: 'msg', from: 8, d: { k: 'ready', token: A.g.online.token } });
  as2.deliver({ t: 'msg', from: 7, d: bs2.payloads('start').slice(-1)[0] });

  assert.equal(A.g.online.seat, 0, 'A is still player 1');
  assert.equal(B.g.online.seat, 1, 'and B is still player 2');
});

/** Dice that give these values in order, for a deal the test can predict. */
function dice(values) {
  const queue = [...values];
  return () => {
    assert.ok(queue.length, 'the deal rolled more often than the test expected');
    return queue.shift();
  };
}

test('the host deals seats at random, not in join order', () => {
  const { h, s } = hostFor(3);
  // Fisher-Yates over [1, 2, 3]: 0 swaps the last with the first -> [3, 2, 1],
  // 0 again swaps the middle with the first -> [2, 3, 1]. Then 0.99 picks who
  // fires first: seat 2. The last two leave the positions in seat order.
  h.g.setDealRandom(dice([0, 0, 0.99, 0.99, 0.99]));
  arrive(s, 2);
  arrive(s, 3);
  const [start] = s.payloads('start');
  assert.deepEqual(start.seats, [2, 3, 1], 'shuffled');
  assert.equal(h.g.online.seat, 2, 'the host is not always player 1');
  assert.equal(start.state.currentPlayer, 2, 'and the rolled seat fires first');
  assert.equal(h.g.currentPlayer, 2);
});

test('with real dice, both who sits where and who fires first vary', () => {
  const hostSeats = new Set(), firsts = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const h = load({ randomDeal: true, seed });
    h.g.el2.onlineSeatsSelect.value = '3';
    const s = connect(h);
    s.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
    arrive(s, 2);
    arrive(s, 3);
    const [start] = s.payloads('start');
    assert.deepEqual([...start.seats].sort(), [1, 2, 3], 'everyone is dealt exactly one seat');
    hostSeats.add(h.g.online.seat);
    firsts.add(start.state.currentPlayer);
  }
  assert.equal(hostSeats.size, 3, 'the host has turned up in every seat');
  assert.equal(firsts.size, 3, 'and every seat has opened a round');
});

test('every screen agrees on who fires first', () => {
  const { h, s } = hostFor(2);
  h.g.setDealRandom(dice([0.2, 0.7, 0.2]));   // seats [2, 1], seat 1 first, slots swapped
  arrive(s, 2);
  const [start] = s.payloads('start');

  const guest = load();
  const gs = connect(guest, 'ABCD');
  gs.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  gs.deliver({ t: 'msg', from: 1, d: start });
  assert.equal(guest.g.online.seat, 0, 'the guest was dealt seat 0');
  assert.equal(guest.g.currentPlayer, 1, 'and sees the host, in seat 1, go first');
  assert.equal(guest.g.currentPlayer, h.g.currentPlayer);
  assert.deepEqual(Array.from(guest.g.tanks, t => t.x), Array.from(h.g.tanks, t => t.x),
    'and on where every tank stands');
  assert.ok(guest.g.tanks[0].x > guest.g.tanks[1].x, 'seat 0 on the right, as rolled');
});

test('a rematch keeps the seats but rolls the first shooter again', () => {
  const { h, s } = hostFor(3);
  h.g.setDealRandom(dice([0.9, 0.9, 0, 0.9, 0.9]));   // seats [1, 2, 3], seat 0 first, slots in order
  arrive(s, 2);
  arrive(s, 3);
  assert.equal(h.g.currentPlayer, 0);
  const seats = Array.from(h.g.online.seats);

  h.g.setDealRandom(dice([0.5, 0.9, 0.9]));           // the rematch: seat 1 first
  h.g.el.restartBtn.dispatch('click');
  const start = s.payloads('start').slice(-1)[0];
  assert.deepEqual(start.seats, seats, 'nobody changes chair mid-match');
  assert.equal(start.state.currentPlayer, 1, 'but seat 0 does not open every round');
});

/** Seats in the order their tanks stand across the field, left to right. */
const lineUp = (g) => Array.from(g.tanks, (t, i) => [t.x, i]).sort((a, b) => a[0] - b[0]).map(p => p[1]);

/** A local game, all human, of `n` tanks, dealt with these dice. */
function localGame(n, rolls, opts = {}) {
  const h = load(opts);
  h.g.el.modeSelect.value = opts.mode || 'human';
  h.g.el.modeSelect.dispatch('change');
  if (rolls) h.g.setDealRandom(dice(rolls));
  h.g.el.countSelect.value = String(n);
  h.g.el.countSelect.dispatch('change');   // a new roster deals a new round
  return h;
}

test('local games roll who fires first and where the tanks stand too', () => {
  // 0.6 of four: seat 2 opens. Then three 0s shuffle the slots [0, 1, 2, 3]
  // to [1, 2, 3, 0]: seat 3 on the left edge, player 1 second from the left.
  const h = localGame(4, [0.6, 0, 0, 0]);
  assert.equal(h.g.currentPlayer, 2);
  assert.deepEqual(lineUp(h.g), [3, 0, 1, 2]);
  assert.equal(h.g.tanks[3].angle, 45, 'the left-hand tank aims right');

  // Play Again rolls both afresh.
  h.g.setDealRandom(dice([0, 0.99, 0.99, 0.99]));
  h.g.state = 'GAMEOVER';
  h.g.el.restartBtn.dispatch('click');
  assert.equal(h.g.currentPlayer, 0);
  assert.deepEqual(lineUp(h.g), [0, 1, 2, 3]);
});

test('with real dice, a local game varies both too', () => {
  const firsts = new Set(), lefts = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const h = localGame(3, null, { randomDeal: true, seed });
    firsts.add(h.g.currentPlayer);
    lefts.add(lineUp(h.g)[0]);
  }
  assert.equal(firsts.size, 3, 'every player has opened');
  assert.equal(lefts.size, 3, 'and every player has stood on the left');
});

test('against the CPU, the CPU can be dealt the first shot, and takes it', () => {
  const h = localGame(2, [0.7, 0.99], { mode: 'cpu' });
  assert.equal(h.g.currentPlayer, 1, 'the CPU opens');
  assert.equal(h.g.isAi(1), true);
  assert.ok(h.advanceUntil(() => h.g.currentPlayer === 0 && h.g.state === 'AIMING'),
    'it fires on its own and hands over');
});

test('each round the host shuffles where the tanks stand', () => {
  const { h, s } = hostFor(3);
  // Seats in join order, seat 0 first, then slots: 0 swaps the last with the
  // first -> [2, 1, 0], 0.99 leaves the middle. Seat 0 takes the right edge.
  h.g.setDealRandom(dice([0.9, 0.9, 0, 0, 0.99]));
  arrive(s, 2);
  arrive(s, 3);
  assert.deepEqual(lineUp(h.g), [2, 1, 0]);
  const start = s.payloads('start')[0];
  assert.deepEqual(start.state.tanks.map(t => t.x), Array.from(h.g.tanks, t => t.x),
    'the positions go out with the board');
  // Aimed at the middle of the field from wherever it now stands.
  assert.equal(h.g.tanks[0].angle, 135, 'seat 0 on the right aims left');
  assert.equal(h.g.tanks[2].angle, 45, 'seat 2 on the left aims right');

  // The rematch: seat 0 first, then 0.5 swaps the last with the middle -> [0, 2, 1].
  h.g.setDealRandom(dice([0, 0.5, 0.99]));
  h.g.el.restartBtn.dispatch('click');
  assert.deepEqual(lineUp(h.g), [0, 2, 1], 'a new line-up for the new round');
  assert.deepEqual(Array.from(h.g.online.seats), [1, 2, 3], 'with everyone in the same seat');
});

test('with real dice, every seat ends up on the left edge', () => {
  const lefts = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const h = load({ randomDeal: true, seed });
    h.g.el2.onlineSeatsSelect.value = '3';
    const s = connect(h);
    s.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
    arrive(s, 2);
    arrive(s, 3);
    const order = lineUp(h.g);
    assert.deepEqual([...order].sort(), [0, 1, 2], 'one tank per slot');
    const xs = h.g.tanks.map(t => t.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      assert.ok(xs[i] - xs[i - 1] >= h.g.TANK_W * 2.5 - 1e-6, 'still well spaced');
    }
    lefts.add(order[0]);
  }
  assert.equal(lefts.size, 3);
});

test('seats a room remembers are kept, whatever the shuffle', () => {
  const A = load({ randomDeal: true }), B = load({ randomDeal: true });
  const as_ = connect(A), bs = connect(B, 'ABCD');
  as_.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  bs.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  as_.deliver({ t: 'peer', id: 2, name: '' });
  as_.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: B.g.online.token } });
  bs.deliver({ t: 'msg', from: 1, d: as_.payloads('start')[0] });
  const seatA = A.g.online.seat, seatB = B.g.online.seat;
  as_.close();
  bs.close();

  // Both back, the other way round, and B now hosts. Dice that would swap
  // them must not.
  const bs2 = connect(B, 'ABCD');
  bs2.deliver({ t: 'joined', room: 'ABCD', id: 7, host: 7, peers: [] });
  B.g.setDealRandom(() => 0);
  const as2 = connect(A, 'ABCD');
  as2.deliver({ t: 'joined', room: 'ABCD', id: 8, host: 7, peers: [{ id: 7, name: '' }] });
  bs2.deliver({ t: 'peer', id: 8, name: '' });
  bs2.deliver({ t: 'msg', from: 8, d: { k: 'ready', token: A.g.online.token } });
  as2.deliver({ t: 'msg', from: 7, d: bs2.payloads('start').slice(-1)[0] });
  assert.equal(A.g.online.seat, seatA, 'A keeps its seat');
  assert.equal(B.g.online.seat, seatB, 'and so does B');
});

test('the deal waits for every player to say hello, not just to connect', () => {
  // Two sockets arrive, but only the second has sent its `ready`. Counting
  // sockets dealt a seat to the first with no token, and its hello, landing
  // a moment later, was then refused as a stranger's.
  const { h, s } = hostFor(3);
  s.deliver({ t: 'peer', id: 2, name: '' });
  s.deliver({ t: 'peer', id: 3, name: '' });
  s.deliver({ t: 'msg', from: 3, d: { k: 'ready', token: 'tok3' } });
  assert.deepEqual(s.payloads('start'), [], 'not dealt while one of them is silent');
  assert.match(h.g.el2.onlineStatus.textContent, /2\/3/, 'the lobby counts players, not sockets');

  s.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: 'tok2' } });
  const [start] = s.payloads('start');
  assert.ok(start, 'dealt once everyone has said hello');
  assert.deepEqual(start.seats, [1, 2, 3]);
  assert.deepEqual(start.tokens, [h.g.online.token, 'tok2', 'tok3'], 'every seat has its owner');
  assert.deepEqual(s.payloads('denied'), [], 'and nobody is turned away');
});
