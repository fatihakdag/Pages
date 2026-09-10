// The turn deadline. A player whose tab is hidden never disconnects, so no
// socket timeout can reach them — a turn nobody takes would hold the game up
// for ever. A seat gets a minute, then it is out of the round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlat } from './harness.mjs';

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

/** A match of `seats` players, seen from the seat at `asSeat`. */
function matchOf(seats, asSeat = 1) {
  const host = loadFlat(), me = loadFlat();
  host.g.el.countSelect.value = String(seats);
  const hs = connect(host), ms = connect(me, 'ABCD');
  const ids = Array.from({ length: seats }, (_, i) => i + 1);
  hs.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  ms.deliver({
    t: 'joined', room: 'ABCD', id: ids[asSeat], host: 1,
    peers: ids.slice(0, asSeat).map(id => ({ id, name: '' }))
  });
  for (const id of ids.slice(1)) {
    hs.deliver({ t: 'peer', id, name: '' });
    hs.deliver({ t: 'msg', from: id, d: { k: 'ready', token: 'tok' + id } });
  }
  ms.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  me.flatTerrain(400);
  return { me, ms, host, hs };
}

test('one missed turn is skipped, not punished', () => {
  const { me, ms } = matchOf(2, 1);
  me.g.currentPlayer = 0;          // not us: the other player is thinking
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();

  me.advance(30000);
  assert.deepEqual(ms.payloads('timeout'), [], 'half a minute is not a timeout');

  me.advance(35000);
  assert.deepEqual(ms.payloads('timeout'), [{ k: 'timeout', seat: 0, missed: 1, ai: false }]);
  assert.equal(me.g.tanks[0].alive, true, 'nobody is knocked out for being slow');
  assert.equal(me.g.netSeatIsAi(0), false, 'and the CPU has not stepped in yet');

  me.advanceUntil(() => me.g.currentPlayer === 1, { maxMs: 5000 });
  assert.equal(me.g.currentPlayer, 1, 'play simply moves on');
});

test('a second miss in a row hands the seat to the CPU, which shoots', () => {
  const { me, ms } = matchOf(2, 1);
  me.placeTanksAt([200, 700]);
  me.g.currentPlayer = 0;
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();

  me.advance(65000);                                   // first miss: skipped
  me.advanceUntil(() => me.g.currentPlayer === 1, { maxMs: 5000 });

  // Our turn comes and goes, then theirs again.
  me.g.state = 'AIMING';
  me.g.currentPlayer = 0;
  me.g.netResetTurnClock();
  me.advance(65000);                                   // second miss

  const events = ms.payloads('timeout');
  assert.equal(events.length, 2);
  assert.deepEqual(events[1], { k: 'timeout', seat: 0, missed: 2, ai: true });
  assert.equal(me.g.netSeatIsAi(0), true, 'the CPU has the seat');
  assert.equal(me.g.tanks[0].alive, true, 'the tank is still in the game');

  // And it plays that turn rather than letting another one lapse. The shot is
  // taken inside the advance above, so look at what went out rather than at a
  // state that has already come back round to AIMING.
  const played = ms.payloads('turn');
  assert.equal(played.length, 1, 'the CPU took the shot');
  assert.equal(played[0].seat, 0, 'for the seat that went quiet');
  assert.equal(played[0].ai, true,
    'marked as a CPU turn, so nobody reads it as the player returning');
});

test('turning up clears the count and hands the seat back', () => {
  const { me, ms } = matchOf(2, 1);
  me.g.currentPlayer = 0;
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();
  me.advance(65000);
  assert.equal(me.g.online.missed[0], 1);

  // They fire for themselves on the next turn.
  ms.deliver({ t: 'msg', from: 1, d: { k: 'turn', seat: 0, angle: 45, power: 50, weapon: 'standard', ai: false } });
  assert.equal(me.g.online.missed[0], 0, 'the count resets');
  assert.equal(me.g.netSeatIsAi(0), false);
});

test('a CPU-played turn does not count as the player returning', () => {
  const { me, ms } = matchOf(2, 1);
  me.g.online.aiSeats.push(0);
  me.g.online.missed[0] = 2;

  ms.deliver({ t: 'msg', from: 1, d: { k: 'turn', seat: 0, angle: 45, power: 50, weapon: 'standard', ai: true } });

  assert.equal(me.g.netSeatIsAi(0), true, 'the CPU keeps the seat');
  assert.equal(me.g.online.missed[0], 2);
});

test('we never time ourselves out — that is for the others to call', () => {
  const { me, ms } = matchOf(2, 1);
  me.g.currentPlayer = 1;          // our own turn
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();

  me.advance(90000);

  assert.deepEqual(ms.payloads('timeout'), [], 'our client does not call time on us');
  assert.equal(me.g.netSeatIsAi(1), false);
});

test('only one player calls it, whatever the table size', () => {
  const calledFrom = (asSeat) => {
    const { me, ms } = matchOf(4, asSeat);
    me.g.currentPlayer = 0;
    me.g.state = 'AIMING';
    me.g.netResetTurnClock();
    me.advance(65000);
    return ms.payloads('timeout').length;
  };
  assert.equal(calledFrom(1), 1, 'the next living seat calls it');
  assert.equal(calledFrom(2), 0, 'and nobody else does');
  assert.equal(calledFrom(3), 0);
});

test('the caller skips seats that are out, and CPU-held seats', () => {
  const { me } = matchOf(4, 2);
  me.g.tanks[1].alive = false;
  assert.equal(me.g.netActsForSeat(0), 2, 'a dead seat cannot call time');

  const other = matchOf(4, 2);
  other.me.g.online.aiSeats.push(1);
  assert.equal(other.me.g.netActsForSeat(0), 2, 'nor can a seat the CPU is playing');
});

test('a timeout announced by someone else is applied here too', () => {
  const { me, ms } = matchOf(4, 2);
  ms.deliver({ t: 'msg', from: 1, d: { k: 'timeout', seat: 3, missed: 2, ai: true } });
  assert.equal(me.g.online.missed[3], 2);
  assert.equal(me.g.netSeatIsAi(3), true);
  assert.equal(me.g.tanks[3].alive, true, 'still in the game, just played for');
});

test('the banner counts down, then says the CPU has the seat', () => {
  const { me } = matchOf(2, 1);
  me.g.currentPlayer = 0;
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();

  me.g.updateHUD();
  assert.doesNotMatch(me.g.el.turnBanner.textContent, /\d+s/, 'quiet with a minute to go');

  me.advance(45000);
  me.g.updateHUD();
  assert.match(me.g.el.turnBanner.textContent, /\d+s/, 'counting down near the end');

  me.g.online.aiSeats.push(0);
  me.g.updateHUD();
  assert.match(me.g.el.turnBanner.textContent, /CPU/, 'and then says who is playing');
});

test('offline play has no deadline at all', () => {
  const h = loadFlat();
  h.placeTanksAt([200, 700]);
  h.g.cpuMode = false;
  h.g.currentPlayer = 0;
  h.g.state = 'AIMING';

  h.advance(120000);

  assert.equal(h.g.tanks[0].alive, true, 'nobody is timed out of a local game');
  assert.equal(h.g.netTurnSecondsLeft(), null, 'and no clock is shown');
});

test('a stand-in plays at a fixed level, not the local difficulty setting', () => {
  assert.equal(loadFlat().g.TURN_AI_LEVEL, 'medium');

  // Two clients with wildly different local settings must produce the same
  // substitute, since the difficulty control is hidden during a match and its
  // value is only whatever that player last picked in a local game.
  const shotFrom = (localLevel) => {
    const { me } = matchOf(2, 1);
    me.g.aiDifficulty = localLevel;
    me.placeTanksAt([200, 700]);
    me.g.currentPlayer = 0;
    me.g.state = 'AIMING';
    me.g.online.aiSeats.push(0);
    me.seedRandom(4242);           // same jitter both times
    me.g.netPlayAiTurn();
    me.advance(3000);
    return [me.g.tanks[0].angle, me.g.tanks[0].power];
  };
  assert.deepEqual(shotFrom('easy'), shotFrom('brutal'),
    'the substitute is the same whoever is standing in');
});

test('a dropped player is not replaced instantly — the clock still decides', () => {
  const { me, ms } = matchOf(2, 1);
  me.placeTanksAt([200, 700]);
  me.g.currentPlayer = 0;
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();

  ms.deliver({ t: 'gone', id: 1, host: 2 });   // their socket died, e.g. a phone minimised
  assert.equal(me.g.online.status, 'playing', 'the match carries on');
  assert.equal(me.g.netSeatIsAi(0), false, 'nobody is replaced on the spot');

  me.advance(65000);                           // first miss: skipped, still theirs
  assert.equal(me.g.netSeatIsAi(0), false, 'one missed turn is not enough');

  // The skip hands play to us; we have to actually take our turn for theirs to
  // come round again.
  me.advanceUntil(() => me.g.currentPlayer === 1 && me.g.state === 'AIMING', { maxMs: 20000 });
  me.g.tanks[1].angle = 45;
  me.g.tanks[1].power = 30;
  me.fireAndSettle();
  assert.equal(me.g.currentPlayer, 0, 'back to the empty seat');

  me.g.netResetTurnClock();
  me.advance(65000);                           // second miss
  assert.equal(me.g.netSeatIsAi(0), true, 'now the CPU plays it');
});

test('a match with an empty seat still moves; it used to deadlock', () => {
  const { me, ms } = matchOf(2, 1);
  me.placeTanksAt([200, 700]);
  me.g.currentPlayer = 0;
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();
  ms.deliver({ t: 'gone', id: 1, host: 2 });

  // Pausing on a departure stopped the turn clock, so nothing could ever
  // happen again — the banner sat on their name for ever.
  const turnsSeen = new Set();
  for (let i = 0; i < 12; i++) {
    me.advance(20000);
    turnsSeen.add(me.g.currentPlayer);
  }
  assert.ok(turnsSeen.size > 1, `play moved on; saw turns ${[...turnsSeen]}`);
});

test('a skipped turn is published, or the two sides end up on different turns', () => {
  const { me, ms, host, hs } = matchOf(2, 1);
  hs.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: 'x' } });   // ignored; already dealt
  me.g.currentPlayer = 0;
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();

  me.advance(65000);                       // we call time on the empty seat

  // We are not the seat that lapsed, so netPublishTurn used to stay silent —
  // and the others never learned the turn had moved at all.
  const sync = ms.payloads('sync').slice(-1)[0];
  assert.ok(sync, 'the client that called time publishes the result');
  assert.equal(sync.state.currentPlayer, me.g.currentPlayer, 'saying whose turn it now is');
  assert.equal(sync.state.wind, me.g.wind, 'and carrying the wind with it');

  // Applying it puts another client on the same turn and the same wind.
  host.g.netApplyState(JSON.parse(JSON.stringify(sync.state)));
  assert.equal(host.g.currentPlayer, me.g.currentPlayer);
  assert.equal(host.g.wind, me.g.wind);
});
