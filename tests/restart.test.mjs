// The HUD's restart button: two taps to throw a round away, and a round thrown
// away mid-shot or mid-CPU-turn leaves nothing of itself behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadFlat } from './harness.mjs';

const terrainOf = (g) => Array.from(g.terrain);
const tap = (g) => g.el.roundRestartBtn.dispatch('click');

test('one tap only arms the restart; the second restarts', () => {
  const h = load();
  const { g } = h;
  const before = terrainOf(g);
  const token = g.turnToken;

  tap(g);
  assert.ok(g.el.roundRestartBtn.classList.contains('armed'), 'the first tap asks');
  assert.deepEqual(terrainOf(g), before, 'and changes nothing');
  assert.equal(g.turnToken, token);

  tap(g);
  assert.ok(!g.el.roundRestartBtn.classList.contains('armed'), 'the question is gone');
  assert.notDeepEqual(terrainOf(g), before, 'a new battlefield');
  assert.ok(g.turnToken > token);
});

test('an armed restart stands down on its own', () => {
  const h = load();
  const { g } = h;
  const before = terrainOf(g);

  tap(g);
  h.advance(g.RESTART_ARM_MS + 50);
  assert.ok(!g.el.roundRestartBtn.classList.contains('armed'));

  tap(g);  // arms again rather than restarting
  assert.ok(g.el.roundRestartBtn.classList.contains('armed'));
  assert.deepEqual(terrainOf(g), before);
});

test('restarting mid-flight clears the shot and starts a fresh round', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.tanks[1].hp = 40;
  g.tanks[0].angle = 60;
  g.tanks[0].power = 70;
  g.fire();
  h.advance(200);
  assert.equal(g.state, 'FIRING');
  assert.ok(g.projectiles.length > 0);

  tap(g); tap(g);

  assert.equal(g.state, 'AIMING');
  assert.equal(g.projectiles.length, 0);
  assert.equal(g.explosions.length, 0);
  assert.equal(g.currentPlayer, 0);
  assert.ok(g.tanks.every(t => t.alive && t.hp === g.MAX_HP), 'everyone back at full health');
  assert.ok(!g.el.overlay.classList.contains('show'));

  // Nothing of the old shot lands later.
  h.advance(3000);
  assert.equal(g.state, 'AIMING');
  assert.ok(g.tanks.every(t => t.hp === g.MAX_HP));
});

test('a CPU shot queued before a restart never fires', () => {
  const h = load();
  const { g } = h;
  g.cpuMode = true;
  g.currentPlayer = 1;
  g.state = 'AIMING';
  g.maybeAiTurn();

  tap(g); tap(g);
  assert.equal(g.currentPlayer, 0, 'the human opens the new round');

  h.advance(10000);
  assert.equal(g.state, 'AIMING', 'nobody fired');
  assert.equal(g.currentPlayer, 0);
  assert.equal(g.projectiles.length, 0);
});

test('the button is labelled in both languages', () => {
  const h = load();
  const { g } = h;
  const btn = g.el.roundRestartBtn;
  assert.equal(btn.getAttribute('aria-label'), g.txt('restartRound'));
  tap(g);
  assert.equal(btn.getAttribute('aria-label'), g.txt('restartConfirm'));
  g.el.langCheckbox.checked = true;
  g.el.langCheckbox.dispatch('change');
  assert.equal(g.lang, 'tr');
  assert.equal(btn.getAttribute('aria-label'), 'Turu yeniden başlatmak için tekrar dokun');
});

test('the landscape rail copy shares the armed state with the controls copy', () => {
  const h = load();
  const { g } = h;
  const before = terrainOf(g);

  g.el.roundRestartRail.dispatch('click');
  assert.ok(g.el.roundRestartBtn.classList.contains('armed'), 'both show the question');
  assert.ok(g.el.roundRestartRail.classList.contains('armed'));

  g.el.roundRestartBtn.dispatch('click');
  assert.notDeepEqual(terrainOf(g), before, 'the second tap counts from either copy');
  assert.ok(!g.el.roundRestartRail.classList.contains('armed'));
});
