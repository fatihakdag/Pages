// Terrain heightmap: sampling, cratering, and the bedrock floor that keeps
// tanks from being buried below the canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadFlat } from './harness.mjs';

test('groundHeightAt samples the heightmap and clamps outside the canvas', () => {
  const h = loadFlat();
  const { g } = h;
  g.terrain[100] = 300;
  g.terrain[101] = 320;

  assert.equal(g.groundHeightAt(100), 300);
  assert.equal(g.groundHeightAt(100.4), 300, 'rounds to the nearest column');
  assert.equal(g.groundHeightAt(100.6), 320);

  // Off-map lookups clamp to the end columns rather than returning undefined —
  // a shell just past the edge is still asked for a ground height.
  assert.equal(g.groundHeightAt(-500), g.terrain[0]);
  assert.equal(g.groundHeightAt(g.W + 500), g.terrain[g.terrain.length - 1]);
});

test('craterAt digs a bowl downward and never lifts the ground', () => {
  const h = loadFlat();
  const { g } = h;
  const y0 = h.flatTerrain(300);

  g.craterAt(400, 300, 40);

  assert.ok(g.terrain[400] > y0, 'centre of the crater is the deepest point');
  assert.ok(g.terrain[400] > g.terrain[420], 'depth falls off toward the rim');
  assert.equal(g.terrain[340], y0, 'ground outside the radius is untouched');
  for (let x = 360; x <= 440; x++) {
    assert.ok(g.terrain[x] >= y0, `column ${x} was raised rather than dug`);
  }
});

test('repeated craters stop at bedrock so tanks stay on screen', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(300);

  for (let i = 0; i < 40; i++) g.craterAt(400, g.groundHeightAt(400), 46);

  assert.ok(g.terrain[400] <= g.bedrockY(), 'crater floor is clamped to bedrock');
  assert.ok(g.bedrockY() < g.H, 'bedrock leaves room for a tank on screen');
});

test('terrain is rebuilt to the canvas width on resize', () => {
  const h = load({ width: 800, height: 500 });
  const { g } = h;
  assert.equal(g.terrain.length, g.W);

  const before = g.terrain.length;
  h.el('game-wrap').getBoundingClientRect = () => ({ width: 1400, height: 500 });
  h.el('game').getBoundingClientRect = () => ({ width: 1400, height: 500 });
  g.resize();

  assert.notEqual(g.terrain.length, before);
  assert.equal(g.terrain.length, g.W);
  assert.ok(g.terrain.every(Number.isFinite), 'resampled terrain has no gaps');
});

test('levelTankPads flattens the ground under each tank', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(300);
  // a ramp under the left tank
  for (let x = 150; x < 250; x++) g.terrain[x] = 300 + (x - 150);
  h.placeTanksAt([200, 700]);

  g.levelTankPads();

  const under = g.groundHeightAt(200);
  assert.ok(Math.abs(g.groundHeightAt(195) - under) < 2, 'pad is level just left of the tank');
  assert.ok(Math.abs(g.groundHeightAt(205) - under) < 2, 'pad is level just right of the tank');
  assert.ok(Math.abs(g.groundHeightAt(150) - 300) < 1e-6, 'slope well outside the pad is untouched');
});
