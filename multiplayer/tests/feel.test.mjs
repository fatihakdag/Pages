// Feeling a hit: the phone buzzes and the battlefield shakes when your own
// tank is hit. Only yours; SHAKE in Settings turns both off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

/** A game with a recording vibrate, in this mode. */
function game(mode = 'cpu') {
  const h = load();
  const buzzes = [];
  h.ctx.navigator.vibrate = (p) => { buzzes.push(p); return true; };
  h.g.el.modeSelect.value = mode;
  h.g.el.modeSelect.dispatch('change');
  h.g.resetGame();
  h.advance(50);
  return { h, g: h.g, buzzes };
}
const shaking = (g) => { const o = g.shakeOffset(); return o.x !== 0 || o.y !== 0; };

test('your tank hit: a buzz sized to the hit, and the battlefield shakes', () => {
  const { h, g, buzzes } = game();
  g.tanks[0].hp -= 20;
  h.advance(16);
  assert.deepEqual(buzzes, [60], 'a middling hit');
  h.advance(40);
  assert.ok(shaking(g), 'shaking');
  h.advance(g.SHAKE_MS);
  assert.ok(!shaking(g), 'and still again soon after');

  g.tanks[0].hp -= 40;
  h.advance(16);
  assert.deepEqual(buzzes.slice(-1), [110], 'a heavy hit, harder');
});

test('destroyed: a double thump', () => {
  const { h, g, buzzes } = game();
  g.tanks[0].hp = 0;
  g.tanks[0].alive = false;
  h.advance(16);
  assert.equal(buzzes.length, 1);
  assert.deepEqual(Array.from(buzzes[0]), [120, 70, 180]);
});

test('the sizes of a hit', () => {
  const { g } = game();
  assert.equal(g.hitPattern(5, false), 30);
  assert.equal(g.hitPattern(20, false), 60);
  assert.equal(g.hitPattern(34, false), 110);
  assert.deepEqual(Array.from(g.hitPattern(10, true)), [120, 70, 180]);
});

test('somebody else\'s tank hit: nothing', () => {
  const { h, g, buzzes } = game();
  g.tanks[1].hp -= 40;
  h.advance(60);
  assert.deepEqual(buzzes, []);
  assert.ok(!shaking(g));
});

test('all human on one screen: nothing, since the phone cannot tell whose hit it is', () => {
  const { h, g, buzzes } = game('human');
  g.tanks[0].hp -= 40;
  h.advance(60);
  assert.deepEqual(buzzes, []);
  assert.ok(!shaking(g));
});

test('a new board is not a hit', () => {
  const { h, g, buzzes } = game();
  g.tanks[0].hp -= 30;
  h.advance(16);
  buzzes.length = 0;
  g.resetGame();       // health back to full, a different tank object
  h.advance(60);
  assert.deepEqual(buzzes, []);
});

test('SHAKE off stills the buzz, the shake and the aiming tick, and is remembered', () => {
  const { h, g, buzzes } = game();
  h.el('shake-select').value = 'off';
  h.el('shake-select').dispatch('change');
  assert.equal(g.shakeOn, false);
  assert.equal(h.ctx.localStorage.getItem('barrage.shake'), 'off');
  g.tanks[0].hp -= 40;
  h.advance(40);
  assert.deepEqual(buzzes, []);
  assert.ok(!shaking(g));
  assert.equal(g.buzz(8), false, 'the tick as the pull crosses its ring too');
});

test('the shake moves the battlefield only, and rolls no dice', () => {
  const { h, g } = game();
  const real = h.ctx.Math.random;
  let draws = 0;
  h.ctx.Math.random = () => { draws++; return real(); };
  g.tanks[0].hp -= 40;
  g.feelHits();
  h.ctx.Math.random = real;
  assert.equal(draws, 0, 'a sway, not noise: the AI’s dice are untouched');

  h.clearTransforms();
  h.advance(30);
  // Fitted, the world is normally drawn from (0, 0): any offset is the shake.
  assert.ok(h.transforms().some(t => t[4] !== 0 || t[5] !== 0), 'the world transform is offset while it shakes');
  h.advance(g.SHAKE_MS);
  h.clearTransforms();
  h.advance(30);
  assert.ok(h.transforms().every(t => t[4] === 0 && t[5] === 0), 'and back in place after');
});

test('online, each screen feels its own tank only', () => {
  const socket = () => {
    const L = {};
    const s = { readyState: 1, sent: [], addEventListener(t, f) { (L[t] ||= []).push(f); }, removeEventListener() {},
      send(x) { s.sent.push(JSON.parse(x)); }, close() {}, emit(t, e) { (L[t] || []).forEach(f => f(e)); },
      deliver(o) { s.emit('message', { data: JSON.stringify(o) }); } };
    return s;
  };
  const host = load(), guest = load();
  const felt = { host: [], guest: [] };
  host.ctx.navigator.vibrate = (p) => { felt.host.push(p); return true; };
  guest.ctx.navigator.vibrate = (p) => { felt.guest.push(p); return true; };
  const hs = socket(), gs = socket();
  host.g.setSocketFactory(() => hs); host.g.netConnect(null); hs.emit('open');
  guest.g.setSocketFactory(() => gs); guest.g.netConnect('ABCD'); gs.emit('open');
  hs.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  gs.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  hs.deliver({ t: 'peer', id: 2, name: '' });
  hs.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: guest.g.online.token } });
  gs.deliver({ t: 'msg', from: 1, d: hs.sent.filter(m => m.t === 'msg' && m.d.k === 'start')[0].d });
  host.advance(50); guest.advance(50);

  // The guest drives seat 1.
  guest.g.tanks[1].hp -= 30;
  guest.g.tanks[0].hp -= 30;
  guest.advance(16);
  assert.deepEqual(felt.guest, [110], 'the guest feels seat 1, once');

  host.g.tanks[1].hp -= 30;
  host.advance(16);
  assert.deepEqual(felt.host, [], 'the host does not feel the guest’s tank');
});
