// The CPU does not play behind a dialog: changing TANKS or OPPONENTS in
// Settings deals a new round at once, and a CPU dealt the first shot used to
// take it with the panel still up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

/** Against the CPU, with the CPU (seat 1) dealt the first shot. */
function cpuFirst() {
  const h = load();
  h.g.setDealRandom(null);
  h.g.el.modeSelect.value = 'cpu';
  h.g.el.modeSelect.dispatch('change');
  h.g.setDealRandom(() => 0.99);   // last seat first, positions shuffled
  return h;
}

const fired = (h) => h.g.state !== 'AIMING' || h.g.currentPlayer !== 1;

test('changing TANKS in Settings: the CPU waits for the panel to close', () => {
  const h = cpuFirst();
  h.g.el.settingsBtn.dispatch('click');
  assert.ok(h.g.settingsIsOpen());
  h.g.el.countSelect.value = '2';
  h.g.el.countSelect.dispatch('change');
  assert.equal(h.g.currentPlayer, 1, 'a new round, the CPU to shoot');
  h.advance(15000);
  assert.equal(fired(h), false, 'nothing fired behind the panel');
  assert.equal(h.g.aiHeld, true);

  h.g.closeDialog();
  assert.equal(h.g.aiHeld, false);
  h.advanceUntil(() => fired(h), 15000);
  assert.ok(fired(h), 'it shoots once the panel is gone');
});

test('the round clock starts when the panel closes, not when it was dealt', () => {
  const h = cpuFirst();
  h.g.el.settingsBtn.dispatch('click');
  h.g.el.countSelect.value = '2';
  h.g.el.countSelect.dispatch('change');
  h.advance(20000);
  const before = h.ctx.performance.now();
  h.g.closeDialog();
  assert.ok(h.g.roundStart >= before - 1, 'restarted on close');
});

test('a CPU already thinking when Settings opens holds its shot', () => {
  const h = cpuFirst();
  h.g.resetGame();
  assert.equal(h.g.currentPlayer, 1);
  h.advance(100);   // it has started thinking
  h.g.el.settingsBtn.dispatch('click');
  h.advance(15000);
  assert.equal(fired(h), false);
  h.g.closeDialog();
  h.advanceUntil(() => fired(h), 15000);
  assert.ok(fired(h));
});

test('the online dialog holds it too', () => {
  const h = cpuFirst();
  h.g.resetGame();
  h.g.openOnline();
  h.advance(15000);
  assert.equal(fired(h), false);
  h.g.closeDialog();
  h.advanceUntil(() => fired(h), 15000);
  assert.ok(fired(h));
});

test('closing a dialog on your own turn does not start the CPU', () => {
  const h = load();
  h.g.el.modeSelect.value = 'cpu';
  h.g.el.modeSelect.dispatch('change');
  assert.equal(h.g.currentPlayer, 0);
  h.g.el.settingsBtn.dispatch('click');
  h.g.closeDialog();
  h.advance(15000);
  assert.equal(h.g.currentPlayer, 0);
  assert.equal(h.g.state, 'AIMING');
});
