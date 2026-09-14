// The online layer: joining a room, dealing seats, and keeping two clients
// holding the same battlefield. The relay itself is tested in ../server; here
// the socket is faked, so these are about what the *game* does with the
// protocol rather than about sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadFlat, routeHeli } from './harness.mjs';

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
  sock.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: 'tok2' } });
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

test('the keyboard is locked on their turn too, not just the buttons', () => {
  const h = loadFlat();
  const sock = hostAMatch(h);
  h.g.currentPlayer = 1; // theirs
  h.g.state = 'AIMING';
  h.g.tanks[1].angle = 100;
  h.g.tanks[1].power = 50;

  h.key('ArrowLeft');
  h.key('ArrowUp');
  h.key(' ', { code: 'Space' });

  assert.equal(h.g.tanks[1].angle, 100, 'the arrows must not aim their tank');
  assert.equal(h.g.tanks[1].power, 50);
  assert.equal(h.g.state, 'AIMING', 'SPACE must not fire their tank');
  assert.equal(sock.payloads('turn').length, 0, 'and no shot goes out for them');

  h.g.currentPlayer = 0; // ours: the keys still work
  h.g.tanks[0].angle = 90;
  h.key('ArrowLeft');
  assert.notEqual(h.g.tanks[0].angle, 90);
});

test('firing sends the inputs and the board they end on, in one message', () => {
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
  assert.equal(turn.seat, 0);
  assert.equal(turn.angle, 40);
  assert.equal(turn.power, 70);
  assert.equal(turn.weapon, 'standard');
  assert.equal(turn.ai, false, 'the player themselves, not the CPU standing in');
  assert.equal(turn.turn, 0, 'fired from the first board of the round');
  assert.equal(typeof turn.seed, 'number', 'with the seed its replay draws from');
  assert.equal(turn.wind, h.g.wind, 'and the wind it was fired into');
  assert.ok(turn.result, 'and the result, worked out before anyone watches');
  assert.equal(turn.result.turn, 1);
  assert.equal(turn.result.currentPlayer, 1, 'which says whose turn comes next');

  assert.equal(h.g.state, 'FIRING', 'here the shell has only just left the barrel');
  assert.equal(h.g.turnSeq, 0);
  assert.deepEqual(Array.from(h.g.terrain), new Array(h.g.W).fill(400),
    'working the result out left the world on screen untouched');
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

test('a message that lands mid-flight waits for the shot to finish', () => {
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
  authoritative.turn = h.g.turnSeq + 1; // published once the shooter's turn resolved
  sock.deliver({ t: 'msg', from: 1, d: { k: 'sync', state: authoritative } });

  assert.equal(h.g.tanks[1].hp, 100, 'the flight is not cut short by the snap');
  assert.equal(h.g.online.inbox.length, 1, 'it waits in the inbox instead');

  h.advanceUntil(() => h.g.state === 'AIMING' || h.g.state === 'GAMEOVER');
  assert.equal(h.g.tanks[1].hp, 42, 'and is applied once the shot lands');
  assert.equal(h.g.online.inbox.length, 0);
});

test('a result that arrives after our own next shot does not undo it', () => {
  const h = loadFlat();
  const sock = joinAMatch(h);
  const host = loadFlat();
  const hostSock = hostAMatch(host);
  sock.deliver({ t: 'msg', from: 1, d: hostSock.payloads('start')[0] });

  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  h.g.wind = 0;
  h.g.currentPlayer = 0;
  h.g.state = 'AIMING';

  // The host fires, and this screen finishes watching it first.
  sock.deliver({ t: 'msg', from: 1,
    d: { k: 'turn', seat: 0, angle: 45, power: 40, weapon: 'standard', ai: false, turn: 0 } });
  h.advanceUntil(() => h.g.state === 'AIMING');
  assert.equal(h.g.currentPlayer, 1, 'our turn');
  // The host's result for that turn — as it will be sent, but not here yet.
  const late = JSON.parse(JSON.stringify(h.g.netSnapshot()));

  // We fire straight away, and their result lands while our shell is in the air.
  h.g.tanks[1].angle = 135;
  h.g.tanks[1].power = 40;
  h.g.fire();
  sock.deliver({ t: 'msg', from: 1, d: { k: 'sync', state: late } });
  h.advanceUntil(() => h.g.state === 'AIMING');

  assert.equal(h.g.currentPlayer, 0, 'the turn goes on to the host, not back to us');
  assert.equal(h.g.turnSeq, 2);
  assert.notDeepEqual(Array.from(h.g.terrain), late.terrain, 'and our crater is still in the ground');
});

test('a shot fired while ours is still landing is watched, not dropped', () => {
  const h = loadFlat();
  const sock = hostAMatch(h);
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  h.g.wind = 0;
  h.g.currentPlayer = 0;
  h.g.tanks[0].angle = 45;
  h.g.tanks[0].power = 40;
  h.g.state = 'AIMING';
  const syncsBefore = sock.payloads('sync').length;
  h.g.fire();

  // The guest's screen landed our shell first, and they have already fired back.
  sock.deliver({ t: 'msg', from: 2,
    d: { k: 'turn', seat: 1, angle: 135, power: 40, weapon: 'standard', ai: false, turn: 1 } });
  assert.equal(h.g.currentPlayer, 0, 'our own shot is not cut off');

  assert.ok(h.advanceUntil(() => h.g.currentPlayer === 1 && h.g.state === 'FIRING'),
    'once ours lands, theirs is replayed');
  h.advanceUntil(() => h.g.state === 'AIMING');
  assert.equal(h.g.currentPlayer, 0, 'and play comes back round to us');
  assert.equal(h.g.turnSeq, 2);
  assert.equal(sock.payloads('turn').length, 1, 'our own result went out with our shot');
  assert.equal(sock.payloads('sync').length, syncsBefore, 'and nothing else is published from here');
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

test('our result goes out with our shot, and the board we land on is that result', () => {
  const h = loadFlat();
  const sock = hostAMatch(h);
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  h.g.currentPlayer = 0;
  h.g.tanks[0].angle = 45;
  h.g.tanks[0].power = 60;
  h.g.state = 'AIMING';

  h.fireAndSettle();
  const turns = sock.payloads('turn');
  assert.equal(turns.length, 1, 'exactly one message per turn');
  assert.deepEqual(sock.payloads('sync'), [], 'no snapshot chasing it');
  assert.equal(h.g.currentPlayer, 1, 'play has moved on here');
  assert.equal(turns[0].result.currentPlayer, 1, 'as the result said it would');
  assert.deepEqual(Array.from(h.g.terrain), turns[0].result.terrain, 'onto exactly the board that was sent');
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

test('an opponent leaving does not stop the match', () => {
  const h = load();
  const sock = hostAMatch(h);
  assert.equal(h.g.online.status, 'playing');

  sock.deliver({ t: 'gone', id: 2, host: 1 });

  // Play carries on: stopping here used to deadlock the game, because the turn
  // clock only runs during a match and so the CPU could never take the seat.
  assert.equal(h.g.online.status, 'playing');
  assert.equal(h.g.el2.onlineStatus.textContent,
    h.g.txt('netEnded', { name: h.g.txt('playerName', { n: 2 }) }),
    'and it says which seat emptied, not just that one did');
  assert.deepEqual(Array.from(h.g.online.vacancies), [1], 'their seat is held for them');
});

test('a dropped connection is reported', () => {
  const h = load();
  const sock = connect(h);
  sock.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  sock.close();
  assert.equal(h.g.online.status, 'offline');
  assert.equal(h.g.el2.onlineStatus.textContent, h.g.txt('netLost'));
});

test('the main screen mirrors the online status, and hides when offline', () => {
  const h = load();
  assert.equal(h.g.el2.netPill.hidden, true, 'a local game carries no online furniture');

  const sock = connect(h);
  sock.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });

  assert.equal(h.g.el2.netPill.hidden, false, 'once online it is on screen');
  assert.equal(h.g.el2.netStatusEl.textContent, h.g.el2.onlineStatus.textContent,
    'and says the same thing as the panel inside Settings');
  assert.match(h.g.el2.netStatusEl.textContent, /ABCD/);
});

test('the main screen offers a way in when there is no connection to report', () => {
  const h = load();
  assert.equal(h.g.el2.netInviteBtn.hidden, false, 'an offline game invites you to play online');
  assert.equal(h.g.el2.netPill.hidden, true, 'and shows no status, because there is none');

  const sock = connect(h);
  sock.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });

  // One or the other, never both: the invitation would be noise next to a
  // live room code.
  assert.equal(h.g.el2.netInviteBtn.hidden, true, 'once online the invitation goes');
  assert.equal(h.g.el2.netPill.hidden, false, 'and the status takes its place');

  h.g.netLeave();
  assert.equal(h.g.el2.netInviteBtn.hidden, false, 'leaving offers the way back in');
});

test('the invitation opens the panel that hosts and joins', () => {
  const h = load();
  h.g.el2.netInviteBtn.dispatch('click');
  assert.ok(h.g.el.settingsModal.classList.contains('show'),
    'it is a shortcut to Settings, not a second lobby');
});

test('a lost connection offers a way back once retrying has given up', () => {
  const h = load();
  const sock = hostAMatch(h);   // dropping out of a live match is what retries
  sock.close();

  // While the automatic attempts are still running there is nothing to ask of
  // the player, so the button stays out of the way.
  assert.equal(h.g.el2.netRejoinBtn.hidden, true, 'not while it is retrying by itself');

  // Exhaust the schedule: each attempt fails to produce a socket and re-arms.
  for (let i = 0; i < h.g.REJOIN_DELAYS_MS.length; i++) h.g.netScheduleRejoin('ABCD');

  assert.equal(h.g.online.rejoin, null, 'it stops trying');
  assert.equal(h.g.el2.netRejoinBtn.hidden, false, 'and hands the decision over');
  assert.equal(h.g.el2.netPill.hidden, false, 'with the status still visible');
});

test('rejoining goes back to the room we were in, without retyping it', () => {
  const h = load();
  const sock = hostAMatch(h);
  sock.close();
  for (let i = 0; i < h.g.REJOIN_DELAYS_MS.length; i++) h.g.netScheduleRejoin('ABCD');

  const next = [];
  h.g.setSocketFactory(() => { const s = fakeSocket(); next.push(s); return s; });
  h.g.el2.netRejoinBtn.dispatch('click');

  assert.equal(next.length, 1, 'it opens a connection');
  next[0].emit('open');
  assert.deepEqual(next[0].sent[0], { t: 'join', v: h.g.NET_PROTOCOL, room: 'ABCD' },
    'to the same room');
});

test('a room we left on purpose is not one we are offered back into', () => {
  const h = load();
  const sock = connect(h);
  sock.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  h.g.netLeave();

  assert.equal(h.g.el2.netRejoinBtn.hidden, true, 'leaving is a decision, not a fault');
  assert.equal(h.g.el2.netPill.hidden, true, 'and the HUD goes quiet again');
});

test('with four seats the status names every player who left', () => {
  const h = load();
  h.g.el.countSelect.value = '4';
  h.g.el.countSelect.dispatch('change');

  const sock = connect(h);
  sock.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  for (const id of [2, 3, 4]) {
    sock.deliver({ t: 'peer', id, name: '' });
    sock.deliver({ t: 'msg', from: id, d: { k: 'ready', token: `tok${id}` } });
  }
  assert.equal(h.g.online.status, 'playing', 'a four-seat match is under way');

  sock.deliver({ t: 'gone', id: 2, host: 1 });
  sock.deliver({ t: 'gone', id: 4, host: 1 });

  const seats = Array.from(h.g.online.vacancies);
  assert.equal(seats.length, 2, 'two chairs are empty');
  // Both, in the order they emptied: naming only the most recent one would
  // leave the earlier seat unaccounted for.
  assert.equal(h.g.netWhoLeft(),
    seats.map(seat => h.g.txt('playerName', { n: seat + 1 })).join(', '));
  assert.equal(h.g.el2.onlineStatus.textContent,
    h.g.txt('netEnded', { name: h.g.netWhoLeft() }));
});

test('losing our own connection is not reported as somebody leaving', () => {
  const h = load();
  const sock = hostAMatch(h);
  sock.close();

  assert.equal(h.g.online.status, 'ended');
  assert.deepEqual(Array.from(h.g.online.vacancies), [], 'nobody left a seat');
  assert.equal(h.g.el2.onlineStatus.textContent, h.g.txt('netLost'),
    'it was our line that went, so it does not accuse a player of leaving');
});

test('switching language re-renders the status, not just the string table', () => {
  const h = load();
  assert.equal(h.g.el2.onlineStatus.textContent, h.g.txt('netOffline'));

  h.g.el.langCheckbox.checked = true;
  h.g.el.langCheckbox.dispatch('change');

  // Having the Turkish string is not the same as showing it: this text is
  // composed in code, so nothing redraws it unless applyLanguage says so.
  assert.equal(h.g.el2.onlineStatus.textContent, h.g.txt('netOffline'));
  assert.equal(h.g.el2.netStatusEl.textContent, h.g.txt('netOffline'));
  assert.notEqual(h.g.txt('netOffline'), 'off', 'and Turkish is not English');
});

test('the room code field is labelled in the chosen language too', () => {
  const h = load();
  assert.equal(h.g.el2.onlineCodeInput.placeholder, h.g.txt('roomCode'));

  h.g.el.langCheckbox.checked = true;
  h.g.el.langCheckbox.dispatch('change');

  // These live in attributes, where the data-i18n sweep cannot reach them.
  assert.equal(h.g.el2.onlineCodeInput.placeholder, h.g.txt('roomCode'));
  assert.notEqual(h.g.txt('roomCode'), 'CODE', 'and Turkish is not English');
});

test('a live room reads in the language the player picked', () => {
  const h = load();
  const sock = connect(h);
  sock.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });

  h.g.el.langCheckbox.checked = true;
  h.g.el.langCheckbox.dispatch('change');

  assert.equal(h.g.el2.onlineStatus.textContent,
    h.g.txt('netWaiting', { code: 'ABCD', n: 1, total: 2 }));
});

test('every online string has a Turkish counterpart', () => {
  const h = load();
  const keys = ['online', 'hostGame', 'joinGame', 'netOffline', 'netConnecting',
    'netWaiting', 'netPlaying', 'netEnded', 'netNoRoom', 'netFull',
    'netVersion', 'netLost', 'rejoin', 'roomCode', 'roomCodeLabel',
    'playWithOthers'];
  h.g.el.langCheckbox.checked = true;
  h.g.el.langCheckbox.dispatch('change');
  for (const k of keys) {
    assert.notEqual(h.g.txt(k), k, `${k} falls through to the key in Turkish`);
  }
});

test('the new wind comes with the shot, so every screen shows the same one', () => {
  const host = load();
  const hs = hostAMatch(host);
  const guest = load();
  const gs = joinAMatch(guest);
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  const shared = guest.g.wind;
  assert.equal(host.g.wind, shared, 'the same to begin with');

  host.flatTerrain(400);
  host.placeTanksAt([200, 700]);
  guest.flatTerrain(400);
  guest.placeTanksAt([200, 700]);

  host.g.currentPlayer = 0;
  host.g.tanks[0].angle = 45;
  host.g.tanks[0].power = 60;
  host.g.state = 'AIMING';
  host.g.fire();
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('turn').slice(-1)[0] });
  host.advanceUntil(() => host.g.state === 'AIMING' || host.g.state === 'GAMEOVER');
  guest.advanceUntil(() => guest.g.state === 'AIMING' || guest.g.state === 'GAMEOVER');

  // Rolling locally showed a figure on the guest's wind gauge that existed
  // nowhere else — and anyone starting to aim in that window aimed against it.
  assert.notEqual(host.g.wind, shared, 'the shooter rolled a new one');
  assert.equal(guest.g.wind, host.g.wind, 'and the guest has it the moment the shot lands');
  assert.deepEqual(hs.payloads('sync'), [], 'without waiting on a snapshot for it');
});

test('a replay on its own lands on exactly the board the shooter sent', () => {
  const host = loadFlat();
  const hs = hostAMatch(host);
  const guest = loadFlat({ width: 390, height: 844 });   // a different screen, too
  const gs = joinAMatch(guest);
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  for (const c of [host, guest]) { c.flatTerrain(400); c.placeTanksAt([200, 700]); c.g.wind = 0; }

  host.g.currentPlayer = 0;
  Object.assign(host.g.tanks[0], { angle: 58, power: 64, weapon: 'cluster' });   // chance decides where bomblets go
  host.g.state = 'AIMING';
  host.g.fire();

  // The inputs alone, without the result to fall back on: if the replay drew
  // anything differently, the board would show it.
  const { result, ...inputs } = hs.payloads('turn')[0];
  gs.deliver({ t: 'msg', from: 1, d: inputs });
  guest.advanceUntil(() => guest.g.state === 'AIMING' || guest.g.state === 'GAMEOVER');

  assert.ok(result.terrain.some(y => y > 400), 'the shot did carve the ground');
  assert.deepEqual(Array.from(guest.g.terrain), result.terrain, 'every crater where the result has it');
  assert.deepEqual(Array.from(guest.g.tanks, t => t.hp), result.tanks.map(t => t.hp), 'and exactly its damage');
});

test('a shot lands in the same place whatever the frame rate', () => {
  const boards = [16, 33, 7].map(frameMs => {
    const h = loadFlat();
    h.flatTerrain(400);
    h.placeTanksAt([200, 700]);
    h.g.currentPlayer = 0;
    Object.assign(h.g.tanks[0], { angle: 50, power: 66, weapon: 'cluster' });
    h.g.state = 'AIMING';
    h.g.fire();
    for (let ms = 0; ms < 30000 && h.g.state !== 'AIMING' && h.g.state !== 'GAMEOVER'; ms += frameMs) {
      h.advance(frameMs, frameMs);
    }
    return { terrain: Array.from(h.g.terrain), hp: Array.from(h.g.tanks, t => t.hp) };
  });
  assert.ok(boards[0].terrain.some(y => y > 400), 'the shot did carve the ground');
  assert.deepEqual(boards[1], boards[0], '30fps lands it where 60fps does');
  assert.deepEqual(boards[2], boards[0], 'and so does 144Hz');
});

test('a helicopter announced mid-shot waits for the shot to land', () => {
  const h = loadFlat();
  const sock = joinAMatch(h);
  const host = loadFlat();
  const hostSock = hostAMatch(host);
  sock.deliver({ t: 'msg', from: 1, d: hostSock.payloads('start')[0] });
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  h.g.currentPlayer = 0;
  h.g.state = 'AIMING';

  sock.deliver({ t: 'msg', from: 1,
    d: { k: 'turn', seat: 0, angle: 45, power: 40, weapon: 'standard', ai: false, turn: 0, seed: 1, wind: 0, heli: null } });
  assert.equal(h.g.state, 'FIRING');

  const arriving = routeHeli(h.g, { id: 5, x: 500, seen: [1] });
  sock.deliver({ t: 'msg', from: 1, d: { k: 'heli', heli: arriving, heliTimer: 90 } });
  assert.equal(h.g.heli, null, 'not dropped into a replay in progress');

  h.advanceUntil(() => h.g.state === 'AIMING');
  assert.equal(h.g.heli && h.g.heli.id, 5, 'and there once the shot has landed');
});

test('a screen a whole shot behind skips ahead to the result', () => {
  const host = loadFlat();
  const hs = hostAMatch(host);
  host.flatTerrain(400);
  host.placeTanksAt([200, 700]);
  host.g.currentPlayer = 0;
  Object.assign(host.g.tanks[0], { angle: 45, power: 40 });
  host.g.state = 'AIMING';
  host.g.fire();
  const first = hs.payloads('turn')[0];

  const guest = loadFlat();
  const gs = joinAMatch(guest);
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  guest.flatTerrain(400);
  guest.placeTanksAt([200, 700]);
  guest.g.state = 'AIMING';

  gs.deliver({ t: 'msg', from: 1, d: first });
  assert.equal(guest.g.activeShot.shot.turn, 0, 'watching the first shot');

  const second = { ...first, seat: 1, turn: 1, result: { ...first.result, turn: 2, currentPlayer: 0 } };
  gs.deliver({ t: 'msg', from: 2, d: second });
  assert.equal(guest.g.activeShot.shot.turn, 0, 'one shot waiting is simply queued');
  assert.equal(guest.g.online.inbox.length, 1);

  const third = { ...first, turn: 2, result: { ...first.result, turn: 3, currentPlayer: 1 } };
  gs.deliver({ t: 'msg', from: 1, d: third });
  assert.equal(guest.g.turnSeq, 1, 'with a second behind it, the first skips straight to its result');
  assert.equal(guest.g.activeShot.shot.turn, 1, 'and the next one starts');
  assert.equal(guest.g.online.inbox.length, 1, 'with the latest still waiting');
});

test('the helicopter is where the clock says, whatever the frame rate', () => {
  const [a, b] = [loadFlat(), loadFlat()];
  const route = routeHeli(a.g, { id: 3, x: 300 });
  for (const h of [a, b]) {
    h.g.state = 'AIMING';
    h.g.heli = h.g.heliIn(route);
  }
  a.advance(3000, 16);
  b.advance(3000, 33);
  assert.deepEqual({ ...a.g.heliDrawPos() }, { ...b.g.heliDrawPos() }, 'exactly the same place');
  assert.ok(Math.abs(a.g.heliDrawPos().x - (300 + 60 * 3)) < 1e-9, 'where three seconds of flight puts it');
});

/** Host and guest on one flat board, with their clocks level. */
function levelMatch() {
  const host = loadFlat();
  const hs = hostAMatch(host);
  const guest = loadFlat();
  const gs = joinAMatch(guest);
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  for (const c of [host, guest]) { c.flatTerrain(400); c.placeTanksAt([200, 700]); c.g.wind = 0; c.g.state = 'AIMING'; }
  assert.equal(host.now, guest.now, 'the two clocks start level');
  return { host, hs, guest, gs };
}

test('a replay that starts late catches up with the shooter, and lands on the same board', () => {
  const { host, hs, guest, gs } = levelMatch();
  Object.assign(host.g.tanks[0], { angle: 55, power: 70, weapon: 'cluster' });
  host.g.currentPlayer = 0;
  host.g.fire();
  const { result, ...inputs } = hs.payloads('turn')[0];

  guest.advance(300);    // the message took 300ms
  gs.deliver({ t: 'msg', from: 1, d: inputs });
  guest.advance(16);
  assert.ok(guest.g.netNow() - guest.g.simClock > 0.25, 'it starts behind');
  guest.advance(700);
  assert.ok(guest.g.netNow() - guest.g.simClock < guest.g.SIM_DT * 2,
    `and within 0.7s is back in step with the clock: ${(guest.g.netNow() - guest.g.simClock).toFixed(3)}s behind`);

  guest.advanceUntil(() => guest.g.state === 'AIMING' || guest.g.state === 'GAMEOVER');
  assert.deepEqual(Array.from(guest.g.terrain), result.terrain, 'the same craters as the shooter worked out');
  assert.deepEqual(Array.from(guest.g.tanks, t => t.hp), result.tanks.map(t => t.hp));
});

test('a replay seconds behind skips most of the way, then catches up', () => {
  const { host, hs, guest, gs } = levelMatch();
  Object.assign(host.g.tanks[0], { angle: 60, power: 80 });
  host.g.currentPlayer = 0;
  host.g.fire();
  const turn = hs.payloads('turn')[0];

  guest.advance(1800);
  gs.deliver({ t: 'msg', from: 1, d: turn });
  guest.advance(16);
  const behind = guest.g.netNow() - guest.g.simClock;
  assert.ok(behind <= guest.g.SHOT_SKIP_TO_S + 0.02, `skipped to about half a second behind: ${behind.toFixed(3)}s`);
  guest.advanceUntil(() => guest.g.state === 'AIMING' || guest.g.state === 'GAMEOVER');
  assert.deepEqual(Array.from(guest.g.terrain), turn.result.terrain);
});

test('a helicopter shot down on a late replay comes down exactly as it did for the shooter', () => {
  const { host, hs, guest, gs } = levelMatch();
  // Hovering all but still over the shooter, and a shell fired straight up at it.
  for (const c of [host, guest]) {
    c.placeTanksAt([500, 850]);
    c.g.heli = c.g.heliIn(routeHeli(c.g, { x: 500, y: 200, speed: 1 }));
  }
  Object.assign(host.g.tanks[0], { angle: 90, power: 60, weapon: 'standard' });
  host.g.currentPlayer = 0;
  host.g.fire();
  const { result, ...inputs } = hs.payloads('turn')[0];
  assert.equal(result.heli, null, 'the shooter brought it down, and the wreck landed');
  assert.ok(result.terrain.some(y => y > 400), 'leaving a crater');

  guest.advance(400);
  gs.deliver({ t: 'msg', from: 1, d: inputs });
  guest.advanceUntil(() => !guest.g.activeShot);
  assert.equal(guest.g.heli, null);
  assert.deepEqual(Array.from(guest.g.terrain), result.terrain, 'where the shooter had the wreck land');
  assert.deepEqual(Array.from(guest.g.tanks, t => t.hp), result.tanks.map(t => t.hp));
});

test('the helicopter never steps back when a late shot starts or when its result lands', () => {
  const { host, hs, guest, gs } = levelMatch();
  const route = routeHeli(host.g, { x: 100, y: 80, speed: 90 });
  for (const c of [host, guest]) c.g.heli = c.g.heliIn(route);
  Object.assign(host.g.tanks[0], { angle: 60, power: 55 });
  host.g.currentPlayer = 0;
  host.g.fire();

  const drawn = [guest.g.heliDrawPos().x];
  const frame = () => { guest.advance(16); if (guest.g.heli) drawn.push(guest.g.heliDrawPos().x); };
  for (let i = 0; i < 12; i++) frame();          // ~200ms of the message on its way
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('turn')[0] });
  for (let i = 0; i < 600 && guest.g.activeShot; i++) frame();
  for (let i = 0; i < 10; i++) frame();          // and past the result
  assert.equal(guest.g.activeShot, null, 'the shot played out');

  const moves = drawn.slice(1).map((x, i) => x - drawn[i]);
  assert.ok(moves.every(d => Math.abs(d - 90 * 0.016) < 1e-6),
    `the same step forward every frame: ${[...new Set(moves.map(d => d.toFixed(3)))].join(', ')}`);
});

test('the clock is measured again every minute', () => {
  const h = load();
  const sock = connect(h);
  sock.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  const samples = () => sock.sent.filter(m => m.t === 'time').length;
  h.advance(2000);
  assert.equal(samples(), 3, 'three samples on joining');
  h.advance(h.g.CLOCK_RESYNC_MS);
  assert.equal(samples(), 6, 'and three more a minute later');
});

test('the first clock sample does not move a helicopter already up', () => {
  const h = loadFlat();
  h.g.state = 'AIMING';
  h.g.heli = h.g.heliIn(routeHeli(h.g, { x: 400 }));
  const before = h.g.heliDrawPos();
  h.g.netClockSample({ t: 'time', c: h.now - 40, s: 1_700_000_000_000 });   // the relay's clock: decades on
  const after = h.g.heliDrawPos();
  // To within float precision at a match clock of 1.7e9 seconds: a millionth of a second.
  assert.ok(Math.abs(after.x - before.x) < 1e-3 && after.y === before.y, `it stays put: ${before.x} → ${after.x}`);
});

test('the match clock is the relay’s, less half the round trip', () => {
  const h = load();
  h.g.netClockSample({ t: 'time', c: h.now - 80, s: 1_700_000_000_000 });
  assert.ok(Math.abs(h.g.netNow() - 1_700_000_000.04) < 1e-6, 'relay time plus the 40ms the answer spent coming back');

  h.g.netClockSample({ t: 'time', c: h.now - 300, s: 5 });
  assert.ok(Math.abs(h.g.netNow() - 1_700_000_000.04) < 1e-6, 'a slower sample is more skewed, and ignored');

  h.g.netClockSample({ t: 'time', c: h.now - 20, s: 1_700_000_000_500 });
  assert.ok(Math.abs(h.g.netNow() - 1_700_000_000.51) < 1e-6, 'a faster one is trusted over it');
});

/** Host and guest on the same flat board, seat 1's turn, with seat 1 held by the CPU. */
function standInMatch() {
  const host = loadFlat();
  const hs = hostAMatch(host);
  const guest = loadFlat();
  const gs = joinAMatch(guest);
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  for (const c of [host, guest]) {
    c.flatTerrain(400);
    c.placeTanksAt([200, 700]);
    c.g.wind = 0;
    c.g.currentPlayer = 1;
    c.g.state = 'AIMING';
    c.g.online.aiSeats.push(1);   // the guest let two turns lapse
  }
  return { host, hs, guest, gs };
}

test('the CPU stands in on the client covering the seat, never on the seat’s own', () => {
  const { host, hs, guest, gs } = standInMatch();
  host.g.netPlayAiTurn();
  guest.g.netPlayAiTurn();
  host.advance(5000);
  guest.advance(5000);

  const hostShots = hs.payloads('turn');
  assert.equal(hostShots.length, 1, 'the host covers seat 1 and plays it');
  assert.equal(hostShots[0].ai, true, 'marked as the CPU');
  assert.deepEqual(gs.payloads('turn'), [], 'the guest does not fire a second shot for its own seat');
});

test('a player who fires as their stand-in does wins the turn, on every screen', () => {
  const { host, hs, guest, gs } = standInMatch();

  // The host's CPU fires for seat 1 ...
  Object.assign(host.g.tanks[1], { angle: 120, power: 70 });
  host.g.fire({ byAi: true });
  // ... in the same moment the guest comes back and fires it themselves.
  Object.assign(guest.g.tanks[1], { angle: 150, power: 40 });
  guest.g.fire();

  const standIn = hs.payloads('turn').slice(-1)[0];
  const player = gs.payloads('turn').slice(-1)[0];
  assert.equal(standIn.ai, true);
  assert.equal(player.ai, false, 'a click is the player, even on a seat the CPU holds');
  assert.notDeepEqual(standIn.result.terrain, player.result.terrain, 'two different shots for one turn');

  hs.deliver({ t: 'msg', from: 2, d: player });
  gs.deliver({ t: 'msg', from: 1, d: standIn });
  host.advanceUntil(() => host.g.state === 'AIMING' && !host.g.activeShot);
  guest.advanceUntil(() => guest.g.state === 'AIMING' && !guest.g.activeShot);

  assert.deepEqual(Array.from(host.g.terrain), player.result.terrain, 'the host lands on the player’s shot, not its stand-in’s');
  assert.deepEqual(Array.from(guest.g.terrain), player.result.terrain, 'and so does the player');
  assert.equal(host.g.turnSeq, guest.g.turnSeq);
  assert.ok(!Array.from(host.g.online.aiSeats).includes(1), 'and the seat is handed back');
});

test('a player’s shot that arrives after the stand-in’s has landed still wins', () => {
  const { host, hs, guest, gs } = standInMatch();
  Object.assign(host.g.tanks[1], { angle: 120, power: 70 });
  host.g.fire({ byAi: true });
  host.advanceUntil(() => host.g.state === 'AIMING' && !host.g.activeShot);
  assert.equal(host.g.turnSeq, 1, 'the stand-in’s shot has played out here');

  Object.assign(guest.g.tanks[1], { angle: 150, power: 40 });
  guest.g.fire();
  const player = gs.payloads('turn').slice(-1)[0];
  hs.deliver({ t: 'msg', from: 2, d: player });

  assert.deepEqual(Array.from(host.g.terrain), player.result.terrain, 'the board is replaced with the player’s');
  assert.ok(!Array.from(host.g.online.aiSeats).includes(1));
});

test('the wind on screen is the wind, not a number this client made up', () => {
  const host = load();
  const hs = hostAMatch(host);
  const guest = load();
  const gs = joinAMatch(guest);
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });

  const snap = host.g.netSnapshot();
  snap.wind = -57.5;                       // an unmistakable value
  guest.g.netApplyState(JSON.parse(JSON.stringify(snap)));

  assert.equal(guest.g.wind, -57.5, 'the physics uses it');
  // Applying a snapshot used to call setWind(), which rolls a *new* random wind
  // and paints that on the HUD before the variable was overwritten. The number
  // and arrow on screen were therefore this client's own invention, while every
  // test that compared g.wind happily passed.
  assert.equal(guest.el('wind-arrow').textContent, '←', 'and the arrow points the right way');
  assert.equal(guest.el('wind-val').textContent, guest.g.windForce() + '/10',
    'and the readout is that wind, not another one');

  // The same figure on both screens, which is the whole point.
  host.g.netApplyState(JSON.parse(JSON.stringify(snap)));
  assert.equal(guest.el('wind-val').textContent, host.el('wind-val').textContent);
  assert.equal(guest.el('wind-arrow').textContent, host.el('wind-arrow').textContent);
});
