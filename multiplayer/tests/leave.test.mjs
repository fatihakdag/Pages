// LEAVE: getting out of an online game and back to one on this screen, and
// what the players left behind see when somebody does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

function fakeSocket({ quietClose = false } = {}) {
  const listeners = {};
  const sock = {
    readyState: 1, sent: [],
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    send(text) { sock.sent.push(JSON.parse(text)); },
    // A browser reports a close later, not inside close(); quietClose lets a
    // test hold it back and deliver it when it likes.
    close() { sock.readyState = 3; if (!quietClose) sock.emit('close'); },
    emit(t, ev) { (listeners[t] || []).forEach(fn => fn(ev)); },
    deliver(obj) { sock.emit('message', { data: JSON.stringify(obj) }); },
    payloads(kind) {
      return sock.sent.filter(m => m.t === 'msg' && (!kind || m.d.k === kind)).map(m => m.d);
    }
  };
  return sock;
}
const connect = (h, room, opts) => {
  const s = fakeSocket(opts);
  h.g.setSocketFactory(() => s);
  h.g.netConnect(room);
  s.emit('open');
  return s;
};

/** Pick a setup the way a player does, so it is saved like theirs would be. */
function choose(h, { mode, count }) {
  if (mode) { h.g.el.modeSelect.value = mode; h.g.el.modeSelect.dispatch('change'); }
  if (count) { h.g.el.countSelect.value = String(count); h.g.el.countSelect.dispatch('change'); }
}

/** A live two-seat match: host id 1 in seat 0, guest id 2 in seat 1. */
function liveMatch({ guestOpts } = {}) {
  const host = load(), guest = load();
  const hs = connect(host), gs = connect(guest, 'ABCD', guestOpts);
  hs.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  gs.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  hs.deliver({ t: 'peer', id: 2, name: '' });
  hs.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: guest.g.online.token } });
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  return { host, guest, hs, gs };
}

const leaveBtn = (h) => h.g.el2.netLeaveBtn;

test('LEAVE sits in the online pill whenever there is one', () => {
  const h = load();
  assert.equal(h.g.el2.netPill.hidden, true, 'nothing to leave offline');
  const s = connect(h);
  s.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  assert.equal(h.g.el2.netPill.hidden, false);
  assert.equal(leaveBtn(h).hidden, false, 'and it is in there');
});

test('in a match it takes two taps, and the first one stands down by itself', () => {
  const { guest, gs } = liveMatch();
  leaveBtn(guest).dispatch('click');
  assert.ok(leaveBtn(guest).classList.contains('armed'), 'the first tap asks');
  assert.equal(guest.g.online.status, 'playing', 'and changes nothing yet');
  assert.deepEqual(gs.payloads('leaving'), []);

  guest.advance(guest.g.RESTART_ARM_MS + 50);
  assert.ok(!leaveBtn(guest).classList.contains('armed'), 'unanswered, it stands down');
  leaveBtn(guest).dispatch('click');
  assert.equal(guest.g.online.status, 'playing', 'so the next tap asks again');
});

test('leaving a match says goodbye and deals a local game on your own settings', () => {
  const host = load(), guest = load();
  choose(guest, { mode: 'human', count: 3 });   // what this player plays locally
  const hs = connect(host), gs = connect(guest, 'ABCD');
  hs.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  gs.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  hs.deliver({ t: 'peer', id: 2, name: '' });
  hs.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: guest.g.online.token } });
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  assert.equal(guest.g.tanks.length, 2, 'the match was two seats');
  const matchTerrain = Array.from(guest.g.terrain);
  const sockets = [];
  guest.g.setSocketFactory(() => { const s = fakeSocket(); sockets.push(s); return s; });

  leaveBtn(guest).dispatch('click');
  leaveBtn(guest).dispatch('click');

  assert.deepEqual(gs.payloads('leaving').map(d => d.seat), [1], 'the others are told which seat');
  assert.equal(gs.readyState, 3, 'and the connection is closed');
  assert.equal(guest.g.online.status, 'offline');
  assert.equal(guest.g.online.error, null, 'leaving is not a failure');
  assert.equal(guest.g.el2.netPill.hidden, true, 'the pill goes');
  assert.equal(guest.g.el2.netInviteBtn.hidden, false, 'and the invitation is back');

  assert.equal(guest.g.el.modeSelect.value, 'human', 'OPPONENTS is theirs again, not Online');
  assert.equal(guest.g.cpuMode, false);
  assert.equal(guest.g.tanks.length, 3, 'three tanks, as they had it');
  assert.notDeepEqual(Array.from(guest.g.terrain), matchTerrain, 'on a fresh board');
  assert.ok(guest.g.tanks.every(t => t.alive && t.hp === 100));
  assert.equal(guest.g.netRemoteSeat(0), false, 'every tank is played here now');
  assert.equal(guest.g.el.fireBtn.disabled, false);

  guest.advance(120000);
  assert.equal(sockets.length, 0, 'and nothing drags them back in');
});

test('against the CPU is what they get back, if that is what they had', () => {
  const { guest } = liveMatch();   // the default setup is vs CPU
  guest.g.netLeave();
  assert.equal(guest.g.el.modeSelect.value, 'cpu');
  assert.equal(guest.g.cpuMode, true);
  assert.equal(guest.g.isAi(1), true);
});

test('the others hand the seat to the CPU at once, and it plays its turn', () => {
  const { host, guest, hs, gs } = liveMatch();
  host.flatTerrain(400);
  host.placeTanksAt([200, 700]);
  // It is the guest's turn when they leave.
  host.g.currentPlayer = 1;
  host.g.state = 'AIMING';
  host.g.netResetTurnClock();

  guest.g.netLeave();
  const [bye] = gs.payloads('leaving');
  hs.deliver({ t: 'msg', from: 2, d: bye });
  hs.deliver({ t: 'gone', id: 2, host: 1 });

  assert.deepEqual(Array.from(host.g.online.aiSeats), [1], 'the CPU has the seat');
  assert.deepEqual(Array.from(host.g.online.vacancies), [1], 'which is still held for them');
  assert.match(host.g.el2.netStatusEl.textContent, /left/);

  // No two turns of waiting: the host covers the seat and plays it now.
  assert.ok(host.advanceUntil(() => hs.payloads('turn').some(t => t.seat === 1 && t.ai),
    { maxMs: 10000 }), 'the CPU fires for them well inside a turn clock');
  assert.deepEqual(hs.payloads('timeout'), [], 'without a single turn timed out');
});

test('coming back with the code resumes the seat from the CPU', () => {
  const { host, guest, hs, gs } = liveMatch();
  guest.g.netLeave();
  hs.deliver({ t: 'msg', from: 2, d: gs.payloads('leaving')[0] });
  hs.deliver({ t: 'gone', id: 2, host: 1 });

  const gs2 = connect(guest, 'ABCD');
  gs2.deliver({ t: 'joined', room: 'ABCD', id: 5, host: 1, peers: [{ id: 1, name: '' }] });
  hs.deliver({ t: 'peer', id: 5, name: '' });
  hs.deliver({ t: 'msg', from: 5, d: gs2.payloads('ready')[0] });
  gs2.deliver({ t: 'msg', from: 1, d: hs.payloads('start').slice(-1)[0] });

  assert.equal(guest.g.online.seat, 1, 'the same chair');
  assert.deepEqual(Array.from(host.g.online.aiSeats), [], 'and the CPU hands it back');
});

test('a close the browser reports late changes nothing', () => {
  const { guest, gs } = liveMatch({ guestOpts: { quietClose: true } });
  guest.g.netLeave();
  const board = Array.from(guest.g.terrain);

  gs.emit('close');   // the old socket, reporting in after the fact
  assert.equal(guest.g.online.status, 'offline');
  assert.equal(guest.g.online.error, null, 'no "connection lost" for a room we left');
  assert.equal(guest.g.el2.netPill.hidden, true);
  assert.equal(guest.g.online.rejoin, null, 'and no attempt to get back in');
  assert.deepEqual(Array.from(guest.g.terrain), board);

  // Hosting straight away is not undone by the old socket either.
  const next = connect(guest);
  gs.emit('close');
  next.deliver({ t: 'joined', room: 'WXYZ', id: 9, host: 9, peers: [] });
  assert.equal(guest.g.online.status, 'waiting');
  assert.equal(guest.g.online.room, 'WXYZ');
});

test('leaving a lobby is one tap, and leaves the local game alone', () => {
  const h = load();
  const board = Array.from(h.g.terrain);
  const s = connect(h);
  s.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });

  leaveBtn(h).dispatch('click');
  assert.equal(h.g.online.status, 'offline', 'no match, nothing to confirm');
  assert.deepEqual(s.payloads('leaving'), [], 'and no seat to hand over');
  assert.deepEqual(Array.from(h.g.terrain), board, 'the game on screen carries on');
});

test('after a failed join, LEAVE clears the error', () => {
  const h = load();
  const board = Array.from(h.g.terrain);
  const s = connect(h, 'QQQQ');
  s.deliver({ t: 'err', code: 'NO_ROOM' });
  assert.equal(h.g.el2.netPill.hidden, false, 'the error is showing');

  leaveBtn(h).dispatch('click');
  assert.equal(h.g.online.error, null);
  assert.equal(h.g.el2.netPill.hidden, true);
  assert.deepEqual(Array.from(h.g.terrain), board);
});

test('after a dropped match, LEAVE swaps the old board for a local one', () => {
  const { guest, gs } = liveMatch();
  gs.close();   // the connection dies; it will try to get back in
  assert.equal(guest.g.online.status, 'ended');
  const board = Array.from(guest.g.terrain);

  leaveBtn(guest).dispatch('click');   // no longer in a match: one tap
  assert.equal(guest.g.online.status, 'offline');
  assert.equal(guest.g.online.rejoin, null, 'it stops trying');
  assert.notDeepEqual(Array.from(guest.g.terrain), board, 'a fresh local round');
});

test('if the host leaves the lobby, the players waiting say hello to the new one', () => {
  // A table of three filling up: host 1, then 2 and 3. Host 1 leaves before
  // it fills. Player 2 is host now, and deals only to players it has heard
  // from — player 3's hello went to the old host.
  const p2 = load(), p3 = load();
  p2.g.el2.onlineSeatsSelect.value = '3';
  const s2 = connect(p2, 'ABCD'), s3 = connect(p3, 'ABCD');
  s2.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  s3.deliver({ t: 'joined', room: 'ABCD', id: 3, host: 1, peers: [{ id: 1, name: '' }, { id: 2, name: '' }] });
  s2.deliver({ t: 'peer', id: 3, name: '' });
  assert.equal(s3.payloads('ready').length, 1);

  s2.deliver({ t: 'gone', id: 1, host: 2 });
  s3.deliver({ t: 'gone', id: 1, host: 2 });
  assert.equal(p2.g.online.host, true);
  assert.equal(s3.payloads('ready').length, 2, 'player 3 says hello again');
  s2.deliver({ t: 'msg', from: 3, d: s3.payloads('ready')[1] });

  // A third player arrives, and the table deals.
  s2.deliver({ t: 'peer', id: 4, name: '' });
  s2.deliver({ t: 'msg', from: 4, d: { k: 'ready', token: 'tok4' } });
  const [start] = s2.payloads('start');
  assert.ok(start, 'dealt');
  assert.deepEqual([...start.seats].sort(), [2, 3, 4]);
  assert.equal(start.tokens[start.seats.indexOf(3)], p3.g.online.token, 'with player 3 in it');
});

test('it speaks the language', () => {
  const { guest } = liveMatch();
  guest.g.el.langCheckbox.checked = true;
  guest.g.el.langCheckbox.dispatch('change');
  assert.equal(guest.g.txt('leaveGame'), 'AYRIL');
  assert.equal(guest.g.txt('leaveSure'), 'EMİN MİSİN?');
});
