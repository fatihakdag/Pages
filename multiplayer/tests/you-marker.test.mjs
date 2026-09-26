// The YOU marker over this screen's own tank. Tanks are dealt to new places
// every round, so for the first few seconds of one each player is shown which
// is theirs — online, and against the CPU.
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

/** A live match of `seats`: the host, one guest (id 2), and the sockets. */
function liveMatch(seats = 2) {
  const host = load(), guest = load();
  host.g.el2.onlineSeatsSelect.value = String(seats);
  const hs = connect(host), gs = connect(guest, 'ABCD');
  hs.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  gs.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  for (let id = 2; id <= seats; id++) {
    hs.deliver({ t: 'peer', id, name: '' });
    hs.deliver({ t: 'msg', from: id, d: { k: 'ready', token: id === 2 ? guest.g.online.token : 'tok' + id } });
  }
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start').slice(-1)[0] });
  return { host, guest, hs, gs };
}

/** What the marker writes when drawn now. */
function drawnLabels(h) {
  const ctx = h.g.canvas.getContext('2d');
  const labels = [];
  const had = ctx.fillText;
  ctx.fillText = (text) => labels.push(text);
  h.g.drawYouMarker();
  ctx.fillText = had;
  return labels;
}

test('a new match points each player at their own tank, then fades', () => {
  const { host, guest } = liveMatch();
  assert.equal(host.g.youMarkAlpha(), 1, 'on the host');
  assert.equal(guest.g.youMarkAlpha(), 1, 'and on the guest');
  assert.deepEqual(drawnLabels(guest), ['YOU']);

  guest.advance(guest.g.YOU_HOLD_MS + guest.g.YOU_FADE_MS / 2);
  const mid = guest.g.youMarkAlpha();
  assert.ok(mid > 0 && mid < 1, `fading (${mid})`);

  guest.advance(guest.g.YOU_FADE_MS);
  assert.equal(guest.g.youMarkAlpha(), 0, 'gone');
  assert.deepEqual(drawnLabels(guest), [], 'and nothing is drawn');
});

test('it speaks the language', () => {
  const { guest } = liveMatch();
  guest.g.el.langCheckbox.checked = true;
  guest.g.el.langCheckbox.dispatch('change');
  assert.deepEqual(drawnLabels(guest), ['SEN']);
});

test('every round raises it again', () => {
  const { host, guest, hs, gs } = liveMatch();
  guest.advance(guest.g.YOU_HOLD_MS + guest.g.YOU_FADE_MS);
  host.advance(host.g.YOU_HOLD_MS + host.g.YOU_FADE_MS);
  assert.equal(guest.g.youMarkAlpha(), 0);

  host.g.el.restartBtn.dispatch('click');
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start').slice(-1)[0] });
  assert.equal(host.g.youMarkAlpha(), 1, 'the host, who dealt it');
  assert.equal(guest.g.youMarkAlpha(), 1, 'and the guest, who was dealt it');
});

test('someone else resuming does not raise it', () => {
  const { host, guest, hs, gs } = liveMatch(3);
  guest.advance(guest.g.YOU_HOLD_MS + guest.g.YOU_FADE_MS);

  // Player 3 drops and comes back into the same round.
  hs.deliver({ t: 'gone', id: 3, host: 1 });
  gs.deliver({ t: 'gone', id: 3, host: 1 });
  hs.deliver({ t: 'peer', id: 9, name: '' });
  hs.deliver({ t: 'msg', from: 9, d: { k: 'ready', token: 'tok3' } });
  const resume = hs.payloads('start').slice(-1)[0];
  assert.ok(resume.seats.includes(9), 'they are back');
  gs.deliver({ t: 'msg', from: 1, d: resume });
  assert.equal(guest.g.youMarkAlpha(), 0, 'nothing changed for this player');
  assert.equal(host.g.online.round, guest.g.online.round);
});

test('against the CPU it points at player 1', () => {
  const h = load();
  h.g.el.modeSelect.value = 'cpu';
  h.g.el.modeSelect.dispatch('change');
  h.g.resetGame();
  assert.equal(h.g.youMarkAlpha(), 1);
  assert.deepEqual(drawnLabels(h), ['YOU']);
  h.advance(h.g.YOU_HOLD_MS + h.g.YOU_FADE_MS);
  assert.equal(h.g.youMarkAlpha(), 0, 'and fades like the online one');
});

test('not all human on one screen, and not over a wrecked tank or a finished round', () => {
  const solo = load();
  solo.g.el.modeSelect.value = 'human';
  solo.g.el.modeSelect.dispatch('change');
  solo.g.resetGame();
  assert.equal(solo.g.youMarkAlpha(), 0, 'every tank here is somebody\'s');

  const { guest } = liveMatch();
  const mine = guest.g.tanks[guest.g.online.seat];
  mine.alive = false;
  assert.equal(guest.g.youMarkAlpha(), 0, 'nothing to point at');
  mine.alive = true;
  guest.g.state = 'GAMEOVER';
  assert.equal(guest.g.youMarkAlpha(), 0, 'the round is over');
});

test('zoomed in elsewhere, it is pinned to the edge rather than lost', () => {
  const { guest } = liveMatch();
  const mine = guest.g.tanks[guest.g.online.seat];
  for (const [x, fx] of [[5, 1], [guest.g.W - 5, 0]]) {
    mine.x = x;
    guest.g.camFit();
    guest.g.camZoomTo(4, fx, 0.5);   // zoomed in on the far side of the field
    const inView = x >= guest.g.camX && x <= guest.g.camX + guest.g.camViewW();
    assert.equal(inView, false, 'the tank is off screen');
    assert.deepEqual(drawnLabels(guest), ['YOU'], 'and the marker is still drawn');
  }
});
