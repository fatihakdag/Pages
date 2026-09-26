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

/** End the round on the host's screen and hand the result to the guest. */
function endRound({ host, gs, hs }) {
  host.g.currentPlayer = 0;
  host.g.tanks[1].alive = false;
  host.g.tanks[1].hp = 0;
  host.g.nextTurn();
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('sync').slice(-1)[0] });
}

test('a guest asking for a rematch goes through the host, not around it', () => {
  const m = liveMatch();
  const { host, guest, hs, gs } = m;
  endRound(m);
  assert.equal(guest.g.state, 'GAMEOVER');
  const guestBoardBefore = terrainOf(guest);

  guest.g.el.restartBtn.dispatch('click');

  // The guest must not reroll its own terrain — that is the desync.
  assert.deepEqual(terrainOf(guest), guestBoardBefore, 'the guest board is untouched');
  const asks = gs.payloads('rematch');
  assert.deepEqual(asks, [{ k: 'rematch', round: 1 }], 'it asks instead');

  hs.deliver({ t: 'msg', from: 2, d: asks[0] });
  const starts = hs.payloads('start');
  assert.equal(starts.length, 2, 'the host deals it');
  gs.deliver({ t: 'msg', from: 1, d: starts[1] });
  assert.deepEqual(terrainOf(guest), terrainOf(host), 'and now they match');
});

test('mid-round, a guest cannot restart the match', () => {
  const { host, hs } = liveMatch();
  const before = terrainOf(host);
  assert.equal(host.g.state, 'AIMING');

  // Whatever the guest's screen offers, a request mid-round is not theirs to make.
  hs.deliver({ t: 'msg', from: 2, d: { k: 'rematch', round: 1 } });

  assert.equal(hs.payloads('start').length, 1, 'nothing is dealt');
  assert.deepEqual(terrainOf(host), before);
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

test('the host restarts with a seat empty, and holds it for its player', () => {
  const { host, hs } = liveMatch();
  const seat1 = host.g.online.seatTokens[1];
  hs.deliver({ t: 'gone', id: 2, host: 1 });
  assert.deepEqual(Array.from(host.g.online.vacancies), [1]);
  host.g.online.aiSeats.push(1);   // the CPU had already taken the chair over
  const before = terrainOf(host);

  host.g.el.restartBtn.dispatch('click');

  const starts = hs.payloads('start');
  assert.equal(starts.length, 2, 'a new board is dealt anyway');
  const deal = starts[1];
  assert.notDeepEqual(terrainOf(host), before);
  assert.deepEqual(deal.seats, [1, null], 'the empty chair stays empty');
  assert.deepEqual(deal.tokens[1], seat1, 'and still belongs to its player');
  assert.deepEqual(deal.vacant, [1]);
  assert.deepEqual(deal.ai, [1], 'the CPU keeps covering it');
  assert.equal(deal.round, 2);

  // They come back, and land on the new board rather than the old one.
  hs.deliver({ t: 'peer', id: 3, name: '' });
  hs.deliver({ t: 'msg', from: 3, d: { k: 'ready', token: seat1 } });
  const back = hs.payloads('start')[2];
  assert.deepEqual(back.seats, [1, 3]);
  assert.equal(back.round, 2, 'the same round, resumed');

  const rejoiner = load();
  const rs = connect(rejoiner, 'ABCD');
  rs.deliver({ t: 'joined', room: 'ABCD', id: 3, host: 1, peers: [{ id: 1, name: '' }] });
  rs.deliver({ t: 'msg', from: 1, d: back });
  assert.equal(rejoiner.g.online.seat, 1, 'in their own seat');
  assert.deepEqual(terrainOf(rejoiner), terrainOf(host), 'on the new board');
  assert.equal(rejoiner.g.online.round, 2);
  assert.deepEqual(Array.from(rejoiner.g.online.vacancies), []);
});

test('a guest learns which seats a restart left empty', () => {
  const host = load(), a = load();
  host.g.el2.onlineSeatsSelect.value = '3';
  const hs = connect(host);
  hs.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  hs.deliver({ t: 'peer', id: 2, name: '' });
  hs.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: 'tok2' } });
  hs.deliver({ t: 'peer', id: 3, name: '' });
  hs.deliver({ t: 'msg', from: 3, d: { k: 'ready', token: 'tok3' } });
  assert.equal(host.g.online.status, 'playing');
  const as = connect(a, 'ABCD');
  as.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  as.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });

  // Seat 3 drops; the host restarts.
  hs.deliver({ t: 'gone', id: 3, host: 1 });
  as.deliver({ t: 'gone', id: 3, host: 1 });
  host.g.online.aiSeats.push(2);   // and the CPU has taken the chair over
  host.g.el.restartBtn.dispatch('click');
  as.deliver({ t: 'msg', from: 1, d: hs.payloads('start').slice(-1)[0] });

  assert.deepEqual(Array.from(a.g.online.vacancies), [2], 'the guest still knows who is missing');
  assert.deepEqual(Array.from(a.g.online.aiSeats), [2], 'and that the CPU is covering for them');
  assert.equal(a.g.online.status, 'playing');
  assert.deepEqual(terrainOf(a), terrainOf(host));
});

test('messages from before a restart do not land on the new board', () => {
  const { host, guest, hs } = liveMatch();

  // The guest's board as it was, with a crater the new round must not inherit.
  guest.g.craterAt(400, guest.g.groundHeightAt(400), 60);
  const stale = { k: 'sync', round: 1, state: guest.g.netSnapshot() };

  host.g.el.roundRestartBtn.dispatch('click');
  host.g.el.roundRestartBtn.dispatch('click');
  assert.equal(host.g.online.round, 2);
  const fresh = terrainOf(host);

  hs.deliver({ t: 'msg', from: 2, d: stale });
  assert.deepEqual(terrainOf(host), fresh, 'the old round\'s sync is dropped');

  hs.deliver({ t: 'msg', from: 2, d: { ...stale, round: 2 } });
  assert.notDeepEqual(terrainOf(host), fresh, 'the same message from this round would have applied');
});

test('a tab going into the background says so before it freezes', () => {
  const { host, guest, hs, gs } = liveMatch();

  guest.setHidden(true);
  assert.deepEqual(gs.payloads('away'), [{ k: 'away', round: 1, hidden: true }],
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
  assert.equal(host.g.el2.onlineStatus.textContent,
    host.g.txt('netEnded', { name: host.g.txt('playerName', { n: 2 }) }));
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

// ---------- The Settings restart ----------

test('in a match, the Settings restart is the host\'s alone', () => {
  const { host, guest, gs } = liveMatch();
  assert.equal(host.g.el.roundRestartBtn.disabled, false);
  assert.equal(guest.g.el.roundRestartBtn.disabled, true);
  assert.equal(guest.g.el.restartNote.textContent, guest.g.txt('restartHostOnly'));

  // Pressed anyway (a stale screen): nothing is sent and nothing changes.
  const before = terrainOf(guest);
  guest.g.onRoundRestartClicked();
  guest.g.onRoundRestartClicked();
  assert.deepEqual(gs.payloads('rematch'), []);
  assert.deepEqual(terrainOf(guest), before);

  // The host leaves; the role, and the button, pass on.
  gs.deliver({ t: 'gone', id: 1, host: 2 });
  assert.equal(guest.g.el.roundRestartBtn.disabled, false);
  assert.equal(guest.g.el.restartNote.textContent, '');
});

test('the host restarting mid-round from Settings takes two taps and deals to everyone', () => {
  const { host, guest, hs, gs } = liveMatch();
  const btn = host.g.el.roundRestartBtn;
  host.g.el.settingsBtn.dispatch('click');
  const before = terrainOf(host);

  btn.dispatch('click');
  assert.ok(btn.classList.contains('armed'));
  assert.equal(hs.payloads('start').length, 1, 'one tap deals nothing');
  assert.deepEqual(terrainOf(host), before);

  btn.dispatch('click');
  assert.ok(!btn.classList.contains('armed'));
  assert.ok(!host.g.el.settingsModal.classList.contains('show'), 'Settings closes onto the new board');
  const deal = hs.payloads('start')[1];
  assert.ok(deal, 'a new start goes out');
  gs.deliver({ t: 'msg', from: 1, d: deal });
  assert.notDeepEqual(terrainOf(host), before);
  assert.deepEqual(terrainOf(guest), terrainOf(host));
  assert.equal(guest.g.online.round, host.g.online.round);
  assert.equal(guest.g.state, 'AIMING');
  assert.equal(guest.g.currentPlayer, 0);
});

test('an armed Settings restart stands down on its own', () => {
  const h = load();
  const btn = h.g.el.roundRestartBtn;
  const before = terrainOf(h);
  btn.dispatch('click');
  h.advance(h.g.RESTART_ARM_MS + 50);
  assert.ok(!btn.classList.contains('armed'));
  btn.dispatch('click');
  assert.deepEqual(terrainOf(h), before, 'that tap armed it again, nothing more');
});

test('offline, the Settings restart just restarts', () => {
  const h = load();
  const before = terrainOf(h);
  h.g.el.roundRestartBtn.dispatch('click');
  h.g.el.roundRestartBtn.dispatch('click');
  assert.notDeepEqual(terrainOf(h), before);
  assert.equal(h.g.online.status, 'offline');
});

test('the Settings restart is off while a match is still being joined', () => {
  const h = load();
  const s = connect(h);
  s.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  assert.equal(h.g.online.status, 'waiting');
  assert.equal(h.g.el.roundRestartBtn.disabled, true);
});
