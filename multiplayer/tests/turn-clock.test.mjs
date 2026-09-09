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
  for (const id of ids.slice(1)) hs.deliver({ t: 'peer', id, name: '' });
  ms.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  me.flatTerrain(400);
  return { me, ms, host, hs };
}

test('a seat that never fires is timed out and taken out of the round', () => {
  const { me, ms } = matchOf(2, 1);
  me.g.currentPlayer = 0;          // not us: the other player is thinking
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();

  me.advance(30000);
  assert.equal(me.g.tanks[0].alive, true, 'half a minute is not a timeout');
  assert.deepEqual(ms.payloads('forfeit'), []);

  me.advance(35000);               // past the minute
  assert.equal(me.g.tanks[0].alive, false, 'the seat is out');
  assert.deepEqual(ms.payloads('forfeit'), [{ k: 'forfeit', seat: 0 }],
    'and everyone is told, once');
});

test('taking your turn in time keeps you in', () => {
  const { me } = matchOf(2, 1);
  me.g.currentPlayer = 1;          // ours
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();
  me.placeTanksAt([200, 700]);

  me.advance(20000);
  me.g.tanks[1].angle = 45;
  me.g.tanks[1].power = 50;
  me.fireAndSettle();

  assert.equal(me.g.tanks[1].alive, true);
  assert.ok(me.g.netTurnSecondsLeft() > 50, 'the clock restarts for the next seat');
});

test('we never forfeit ourselves — that is for the others to call', () => {
  const { me, ms } = matchOf(2, 1);
  me.g.currentPlayer = 1;          // our own turn
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();

  me.advance(90000);               // sit on our hands well past the limit

  assert.equal(me.g.tanks[1].alive, true, 'our client does not remove us');
  assert.deepEqual(ms.payloads('forfeit'), []);
});

test('only one player calls it, whatever the table size', () => {
  // Seat 0 is thinking. Seat 1 is the lowest living seat that is not seat 0, so
  // seat 1 enforces and seats 2 and 3 stay out of it.
  const seenFrom = (asSeat) => {
    const { me, ms } = matchOf(4, asSeat);
    me.g.currentPlayer = 0;
    me.g.state = 'AIMING';
    me.g.netResetTurnClock();
    me.advance(65000);
    return ms.payloads('forfeit').length;
  };
  assert.equal(seenFrom(1), 1, 'the next living seat calls it');
  assert.equal(seenFrom(2), 0, 'and nobody else does');
  assert.equal(seenFrom(3), 0);
});

test('the enforcer skips seats already knocked out', () => {
  const { me } = matchOf(4, 2);
  me.g.tanks[1].alive = false;     // seat 1 is gone, so seat 2 is next in line
  me.g.currentPlayer = 0;
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();

  assert.equal(me.g.netEnforcerFor(0), 2, 'the dead seat is passed over');
  me.advance(65000);
  assert.equal(me.g.tanks[0].alive, false, 'and we call it instead');
});

test('a forfeit announced by someone else is applied here too', () => {
  const { me, ms } = matchOf(4, 2);
  assert.equal(me.g.tanks[3].alive, true);

  ms.deliver({ t: 'msg', from: 4, d: { k: 'forfeit', seat: 3 } });

  assert.equal(me.g.tanks[3].alive, false);
  assert.equal(me.g.tanks[3].hp, 0);
});

test('the banner counts down in the last stretch', () => {
  const { me } = matchOf(2, 1);
  me.g.currentPlayer = 0;
  me.g.state = 'AIMING';
  me.g.netResetTurnClock();

  me.g.updateHUD();
  assert.doesNotMatch(me.g.el.turnBanner.textContent, /\d+s/, 'quiet with a minute to go');

  me.advance(45000);               // 15s left
  me.g.updateHUD();
  assert.match(me.g.el.turnBanner.textContent, /1[0-9]s|[0-9]s/,
    `expected a countdown, got "${me.g.el.turnBanner.textContent}"`);
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
