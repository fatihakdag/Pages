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
  hs.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: 'tok2' } });
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
  assert.deepEqual(Array.from(guest.g.online.vacancies), [0], 'seat 0 is kept open');
  assert.equal(guest.g.online.status, 'playing', 'and the match carries on without them');
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
  // They come back presenting the token that owns seat 0 — the only way in.
  const seat0 = guest.g.online.seatTokens[0];
  gs.deliver({ t: 'peer', id: 3, name: '' });
  gs.deliver({ t: 'msg', from: 3, d: { k: 'ready', token: seat0 } });

  const starts = gs.payloads('start');
  assert.equal(starts.length, 1, 'the remaining player deals them back in');
  assert.deepEqual(starts[0].seats, [3, 2], 'the newcomer takes the empty seat');
  assert.deepEqual(Array.from(starts[0].state.terrain), midMatch,
    'and is handed the board as it stands, craters and all');
  assert.equal(starts[0].state.tanks[1].hp, 48, 'damage is not undone');
  assert.equal(guest.g.online.status, 'playing');
  assert.equal(guest.g.online.vacancies.length, 0, 'the chair is filled');
});

test('the rejoining player lands on that board, in that seat', () => {
  const { host, guest, hs, gs } = liveMatch();
  host.g.craterAt(400, host.g.groundHeightAt(400), 44);
  gs.deliver({ t: 'msg', from: 1, d: { k: 'sync', state: host.g.netSnapshot() } });
  gs.deliver({ t: 'gone', id: 1, host: 2 });
  const seat0 = guest.g.online.seatTokens[0];
  gs.deliver({ t: 'peer', id: 3, name: '' });
  gs.deliver({ t: 'msg', from: 3, d: { k: 'ready', token: seat0 } });

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

test('a tab going into the background says so before it freezes', () => {
  const { host, guest, hs, gs } = liveMatch();

  guest.setHidden(true);
  assert.deepEqual(gs.payloads('away'), [{ k: 'away', hidden: true }],
    'the message goes out while the page is still running normally');

  hs.deliver({ t: 'msg', from: 2, d: { k: 'away', hidden: true } });
  assert.equal(host.g.online.peerAway, true);
  assert.equal(host.g.el2.onlineStatus.textContent, host.g.txt('netAway'));

  // On the away player's turn the banner explains the wait rather than
  // showing an ordinary "aim and fire".
  host.g.currentPlayer = 1;
  host.g.state = 'AIMING';
  host.g.updateHUD();
  assert.match(host.g.el.turnBanner.textContent, /AWAY/);

  guest.setHidden(false);
  hs.deliver({ t: 'msg', from: 2, d: { k: 'away', hidden: false } });
  assert.equal(host.g.online.peerAway, false, 'and it clears when they come back');
  host.g.updateHUD();
  assert.doesNotMatch(host.g.el.turnBanner.textContent, /AWAY/);
});

test('nothing is announced when we are not in a match', () => {
  const h = load();
  const s = connect(h);
  s.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  h.setHidden(true);
  assert.deepEqual(s.payloads('away'), [], 'a lobby has nobody to tell');
});

test('a player who leaves is gone, not away', () => {
  const { host, hs } = liveMatch();
  hs.deliver({ t: 'msg', from: 2, d: { k: 'away', hidden: true } });
  assert.equal(host.g.online.peerAway, true);

  hs.deliver({ t: 'gone', id: 2, host: 1 });
  assert.equal(host.g.online.peerAway, false, 'the status says left, not away');
  assert.equal(host.g.el2.onlineStatus.textContent, host.g.txt('netEnded'));
});

test('a connection lost mid-match comes back on its own', () => {
  const { guest, gs } = liveMatch();
  const sockets = [];
  guest.g.setSocketFactory(() => {
    const s = fakeSocket();
    sockets.push(s);
    // A real socket opens asynchronously; this one is driven by the test.
    return s;
  });

  gs.close();                       // the phone switched apps, the socket died
  assert.equal(guest.g.online.status, 'ended');
  // Compared field by field: the object comes out of the vm context, so a
  // deepStrictEqual fails on its prototype however equal the values are.
  assert.equal(guest.g.online.rejoin.code, 'ABCD', 'queued for the room we were in');
  assert.equal(guest.g.online.rejoin.tries, 1);

  guest.advance(1500);              // past the first backoff
  assert.equal(sockets.length, 1, 'it dialled again by itself');
  sockets[0].emit('open');
  assert.deepEqual(sockets[0].sent[0], { t: 'join', v: guest.g.NET_PROTOCOL, room: 'ABCD' },
    'and asked for the same room, so the held seat is ours again');

  sockets[0].deliver({ t: 'joined', room: 'ABCD', id: 9, host: 1, peers: [{ id: 1 }] });
  assert.equal(guest.g.online.rejoin, null, 'the attempt is over once we are in');
});

test('it keeps trying, backing off, rather than giving up at the first failure', () => {
  const { guest, gs } = liveMatch();
  const sockets = [];
  guest.g.setSocketFactory(() => { const s = fakeSocket(); sockets.push(s); return s; });

  gs.close();
  for (let i = 1; i <= 3; i++) {
    guest.advance(guest.g.REJOIN_DELAYS_MS[i - 1] + 100);
    assert.equal(sockets.length, i, `attempt ${i} was made`);
    sockets[i - 1].close();          // the relay is still unreachable
  }
  assert.equal(guest.g.online.rejoin.tries, 4, 'and it is still trying');
});

test('a room that is gone is not chased', () => {
  const { guest, gs } = liveMatch();
  const sockets = [];
  guest.g.setSocketFactory(() => { const s = fakeSocket(); sockets.push(s); return s; });

  gs.close();
  guest.advance(1500);
  sockets[0].emit('open');
  sockets[0].deliver({ t: 'err', code: 'NO_ROOM', msg: 'no room ABCD' });

  assert.equal(guest.g.online.rejoin, null, 'the grace period ran out; stop');
  guest.advance(120000);
  assert.equal(sockets.length, 1, 'and no further attempts');
});

test('leaving on purpose does not reconnect us', () => {
  const { guest, gs } = liveMatch();
  const sockets = [];
  guest.g.setSocketFactory(() => { const s = fakeSocket(); sockets.push(s); return s; });

  guest.g.netLeave();               // the player chose to go
  assert.equal(guest.g.online.rejoin, null);
  guest.advance(120000);
  assert.equal(sockets.length, 0, 'we do not drag them back in');
});

test('the end of the round reaches every screen, not just the winner’s', () => {
  const { host, guest, hs, gs } = liveMatch();
  host.flatTerrain(400);
  host.placeTanksAt([200, 700]);

  // The host's turn ends with the other tank destroyed, so only the host runs
  // endTurnCheckWin(). Killed outright rather than shot at, so the test does
  // not depend on a particular arc connecting.
  host.g.currentPlayer = 0;
  host.g.tanks[1].alive = false;
  host.g.tanks[1].hp = 0;
  host.g.nextTurn();
  assert.equal(host.g.state, 'GAMEOVER', 'the host sees the round end');

  const sync = hs.payloads('sync').slice(-1)[0];
  assert.equal(sync.state.state, 'GAMEOVER');
  assert.equal(sync.state.winner, 0, 'and the snapshot says who won');

  gs.deliver({ t: 'msg', from: 1, d: sync });
  assert.equal(guest.g.state, 'GAMEOVER');
  assert.ok(guest.g.el.overlay.classList.contains('show'),
    'the loser is shown the result rather than left staring at a dead game');
  assert.match(guest.g.el.overlay.textContent + guest.g.txt('wins', { name: 'x' }), /wins|kazan/i);
});
