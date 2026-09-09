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

test('the world is a fixed size, whatever the canvas is', () => {
  const small = load({ width: 320, height: 480 });
  const big = load({ width: 1600, height: 900 });

  // Two players on very different screens must hold the same battlefield.
  assert.equal(small.g.W, big.g.W);
  assert.equal(small.g.H, big.g.H);
  assert.equal(small.g.terrain.length, small.g.W);
  assert.equal(big.g.terrain.length, big.g.W);

  // What differs is only how large it is drawn.
  assert.ok(small.g.viewScale < big.g.viewScale, 'the small canvas draws it smaller');
  assert.ok(small.g.viewW <= 320 && small.g.viewH <= 480, 'the view fits its box');
});

test('resizing does not disturb the world', () => {
  const h = load({ width: 800, height: 500 });
  const { g } = h;

  // Blow a hole in the ground and note it.
  const groundY = g.groundHeightAt(400);
  g.craterAt(400, groundY, 40);
  const cratered = Array.from(g.terrain);
  const tankXs = g.tanks.map(t => t.x);

  h.el('game-wrap').getBoundingClientRect = () => ({ width: 1400, height: 500 });
  h.el('game').getBoundingClientRect = () => ({ width: 1400, height: 500 });
  g.resize();

  // The old build regenerated terrain from the seed shape here, which erased
  // every crater and stranded the tanks; rotating a phone reset the landscape.
  assert.equal(g.terrain.length, cratered.length);
  assert.deepEqual(Array.from(g.terrain), cratered, 'craters survive a resize');
  assert.deepEqual(g.tanks.map(t => t.x), tankXs, 'tanks stay put');
});

test('a shell in flight is not disturbed by a resize', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.tanks[0].angle = 45;
  g.tanks[0].power = 70;
  g.fire();
  h.advance(160);
  const before = g.projectiles.map(p => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy }));
  assert.ok(before.length, 'a shell is in the air');

  h.el('game-wrap').getBoundingClientRect = () => ({ width: 1400, height: 900 });
  g.resize();

  // Velocities used to be rescaled on resize because physics was in canvas
  // pixels. In world units there is nothing to rescale.
  assert.deepEqual(
    g.projectiles.map(p => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy })),
    before
  );
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
