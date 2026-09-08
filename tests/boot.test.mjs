// The game boots and runs. If this fails, nothing else in the suite means much.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from './harness.mjs';

test('the page boots into a playable round', () => {
  const h = load();
  const { g } = h;

  assert.equal(g.state, 'AIMING');
  assert.equal(g.tanks.length, 2, 'the default roster');
  assert.ok(g.tanks.every(t => t.alive && t.hp === g.MAX_HP));
  assert.equal(g.terrain.length, g.W);
  assert.ok(g.W > 0 && g.H > 0);
  assert.ok(g.physScale > 0);
});

test('the render loop runs for a while without throwing', () => {
  const h = load();
  h.advance(5000);
  assert.ok(h.g.terrain.every(Number.isFinite));
});

test('a full two-player exchange plays out', () => {
  const h = load({ seed: 99 });
  const { g } = h;
  g.cpuMode = false;
  g.resetGame();

  for (let turn = 0; turn < 6 && g.state !== 'GAMEOVER'; turn++) {
    const seat = g.currentPlayer;
    g.tanks[seat].power = 60;
    g.state = 'AIMING';
    h.fireAndSettle();
    assert.notEqual(g.currentPlayer, seat, 'each shot hands the turn on');
  }
});

test('a CPU round plays itself through to a winner', () => {
  const h = load({ seed: 5 });
  const { g } = h;
  g.cpuMode = true;
  g.aiDifficulty = 'brutal';
  g.resetGame();

  // Seat 1 is human here, so play it as a bystander that always misses; the
  // CPU should eventually finish the round.
  for (let turn = 0; turn < 60 && g.state !== 'GAMEOVER'; turn++) {
    if (g.state === 'AIMING' && !g.isAi(g.currentPlayer)) {
      g.tanks[g.currentPlayer].angle = 89;
      g.tanks[g.currentPlayer].power = 10;
      g.fire();
    }
    h.advance(4000);
  }

  assert.equal(g.state, 'GAMEOVER');
  assert.equal(g.tanks.filter(t => t.alive).length, 1);
  assert.ok(g.el.overlay.classList.contains('show'));
});

test('the test seam does not leak into the game', () => {
  const h = load();
  const src = h.ctx.window.__BARRAGE_TEST__;
  assert.ok(src, 'the seam is present');
  // The seam is read by tests only; nothing in the page should reference it.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const uses = html.split('__BARRAGE_TEST__').length - 1;
  assert.equal(uses, 1, 'the seam is assigned once and never read by the game');
});
