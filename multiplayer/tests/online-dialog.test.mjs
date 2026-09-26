// The Play online dialog: hosting, joining and the room, apart from Settings.
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
    close() { sock.readyState = 3; sock.emit('close'); },
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
const isOpen = (el) => el.classList.contains('show');

/** A host that has dealt a two-seat match against guest id 2 (named Bo). */
function hostAMatch(h) {
  const s = connect(h);
  s.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  s.deliver({ t: 'peer', id: 2, name: '' });
  s.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: 'tok2', name: 'Bo' } });
  return s;
}

/** The rows of the player list, as [name, tag]. */
function playerRows(h) {
  const list = h.g.el2.onlinePlayers.children;
  return list.slice(-h.g.tanks.length).map(li => [li.children[1].textContent, li.children[2].textContent]);
}

test('PLAY WITH OTHERS and the status pill open the online dialog', () => {
  const h = load();
  h.g.el2.netInviteBtn.dispatch('click');
  assert.ok(isOpen(h.g.el2.onlineModal));
  h.g.closeDialog();

  connect(h).deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  h.g.el2.netStatusEl.dispatch('click');
  assert.ok(isOpen(h.g.el2.onlineModal), 'the pill, once there is a room');
});

test('Settings points to it, and only one dialog is ever open', () => {
  const h = load();
  h.g.el.settingsBtn.dispatch('click');
  assert.ok(isOpen(h.g.el.settingsModal));
  h.g.el2.openOnlineBtn.dispatch('click');
  assert.ok(isOpen(h.g.el2.onlineModal), 'PLAY ONLINE › in Settings');
  assert.ok(!isOpen(h.g.el.settingsModal), 'and Settings steps aside');

  h.g.el.settingsBtn.dispatch('click');
  assert.ok(isOpen(h.g.el.settingsModal));
  assert.ok(!isOpen(h.g.el2.onlineModal), 'the other way round too');
});

test('Escape closes it, and the gun does not fire from behind it', () => {
  const h = load();
  h.g.cpuMode = false;
  h.g.state = 'AIMING';
  h.g.openOnline();
  h.key(' ', { code: 'Space' });
  assert.equal(h.g.state, 'AIMING', 'SPACE belongs to the dialog while it is up');
  h.key('Escape');
  assert.ok(!isOpen(h.g.el2.onlineModal));
  assert.equal(h.g.dialogOpen(), false);
});

test('with no connection it is the way in: name, host, join', () => {
  const h = load();
  h.g.openOnline();
  const { onlineWayIn, onlineRoomView, onlineStatus } = h.g.el2;
  assert.equal(onlineWayIn.hidden, false);
  assert.equal(onlineRoomView.hidden, true);
  assert.equal(onlineStatus.hidden, true, 'nothing to report yet');
});

test('a failed join says so on the way in', () => {
  const h = load();
  h.g.openOnline();
  const s = connect(h, 'QQQQ');
  s.deliver({ t: 'err', code: 'NO_ROOM' });
  assert.equal(h.g.el2.onlineWayIn.hidden, false, 'still the way in, to try again');
  assert.equal(h.g.el2.onlineStatus.hidden, false);
  assert.notEqual(h.g.el2.onlineStatus.textContent, '');
});

test('hosting, it shows the code to share while the table fills', () => {
  const h = load();
  h.g.el2.onlineSeatsSelect.value = '3';
  h.g.openOnline();
  const s = connect(h);
  assert.equal(h.g.el2.onlineRoomView.hidden, false, 'connecting: the room view already');
  s.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  assert.equal(h.g.el2.onlineRoomCode.textContent, 'ABCD');
  assert.equal(h.g.el2.onlineShare.hidden, false, 'share this code');
  assert.equal(h.g.el2.onlinePlayers.hidden, true, 'no table yet');
  assert.match(h.g.el2.onlineStatus.textContent, /1\/3/);
});

test('it steps aside when the table is dealt, and then lists who is there', () => {
  const h = load();
  h.g.el2.onlineNameInput.value = 'Ada';
  h.g.openOnline();
  hostAMatch(h);
  assert.ok(!isOpen(h.g.el2.onlineModal), 'the board, not the dialog');

  h.g.openOnline();
  assert.equal(h.g.el2.onlineShare.hidden, true, 'the table is full: nothing to share');
  assert.equal(h.g.el2.onlinePlayers.hidden, false);
  assert.deepEqual(playerRows(h), [['Ada', h.g.txt('opYou')], ['Bo', '']]);
});

test('the list says who left and who the CPU is standing in for', () => {
  const h = load();
  const s = hostAMatch(h);
  s.deliver({ t: 'gone', id: 2, host: 1 });
  h.g.openOnline();
  assert.deepEqual(playerRows(h)[1], ['Bo', h.g.txt('opLeft')]);

  h.g.online.vacancies = [];
  h.g.online.aiSeats = [1];
  h.g.updateHUD();   // a takeover refreshes the HUD, and the open dialog with it
  assert.deepEqual(playerRows(h)[1], ['Bo', h.g.txt('cpuBadge')]);
});

test('PLAYERS sets the table size, and TANKS stays the local game\'s', () => {
  const h = load();
  const tanks = h.g.el.countSelect.value;
  const local = h.g.tanks.length;
  h.g.el2.onlineSeatsSelect.value = '3';
  h.g.el2.onlineSeatsSelect.dispatch('change');
  assert.equal(h.g.el.countSelect.value, tanks, 'TANKS untouched');
  assert.equal(h.g.tanks.length, local, 'and so is the game on screen');
  assert.equal(h.ctx.localStorage.getItem('barrage.onlineSeats'), '3', 'remembered');

  const s = connect(h);
  s.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  s.deliver({ t: 'peer', id: 2, name: '' });
  s.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: 'tok2' } });
  assert.deepEqual(s.payloads('start'), [], 'a table of three waits for a third');
  s.deliver({ t: 'peer', id: 3, name: '' });
  s.deliver({ t: 'msg', from: 3, d: { k: 'ready', token: 'tok3' } });
  assert.equal(s.payloads('start')[0].seats.length, 3);
});

test('a host still waiting can shrink the table, and it deals', () => {
  const h = load();
  h.g.el2.onlineSeatsSelect.value = '4';
  const s = connect(h);
  s.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  s.deliver({ t: 'peer', id: 2, name: '' });
  s.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: 'tok2' } });
  assert.equal(h.g.el2.onlineSeatsSelect.disabled, false, 'still theirs to change');
  h.g.el2.onlineSeatsSelect.value = '2';
  h.g.el2.onlineSeatsSelect.dispatch('change');
  assert.equal(s.payloads('start')[0].seats.length, 2);
  assert.equal(h.g.el2.onlineSeatsSelect.disabled, true, 'dealt: fixed for the match');
});

test('LEAVE in the dialog takes two taps in a match, with the pill\'s, and closes it', () => {
  const h = load();
  hostAMatch(h);
  h.g.openOnline();
  const { onlineLeaveBtn, netLeaveBtn } = h.g.el2;
  onlineLeaveBtn.dispatch('click');
  assert.ok(onlineLeaveBtn.classList.contains('armed'));
  assert.ok(netLeaveBtn.classList.contains('armed'), 'the pill asks the same question');
  assert.equal(h.g.online.status, 'playing');

  onlineLeaveBtn.dispatch('click');
  assert.equal(h.g.online.status, 'offline');
  assert.ok(!isOpen(h.g.el2.onlineModal), 'back to the game on this screen');
});

test('after a dropped connection it offers REJOIN once retrying gives up', () => {
  const h = load();
  const s = hostAMatch(h);
  s.close();
  for (let i = 0; i < h.g.REJOIN_DELAYS_MS.length; i++) h.g.netScheduleRejoin('ABCD');
  h.g.openOnline();
  assert.equal(h.g.el2.onlineRoomView.hidden, false);
  assert.equal(h.g.el2.onlineRejoinBtn.hidden, false);
});

test('it speaks the language', () => {
  const h = load();
  h.g.el.langCheckbox.checked = true;
  h.g.el.langCheckbox.dispatch('change');
  assert.equal(h.g.txt('playOnline'), 'ÇEVRİMİÇİ OYNA');
  for (const key of ['yourNameTitle', 'hostTitle', 'joinTitle', 'roomTitle', 'shareCode', 'opYou', 'opLeft']) {
    assert.notEqual(h.g.txt(key), key, key);
  }
});
