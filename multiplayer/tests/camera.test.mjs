// The camera. A fixed-shape world has to be drawn small on a phone, so the view
// can be zoomed and panned — but it is only a way of looking, and the thing
// that matters most here is that it cannot reach the simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadFlat } from './harness.mjs';

test('the camera starts fitted to the whole world', () => {
  const { g } = load();
  assert.equal(g.camZoom, g.CAM_MIN);
  assert.equal(g.camX, 0);
  assert.equal(g.camY, 0);
  assert.equal(g.camViewW(), g.W, 'the whole width is in view');
  assert.equal(g.camViewH(), g.H);
});

test('zooming shows proportionally less of the world', () => {
  const { g } = load();
  g.camZoomTo(2);
  assert.equal(g.camViewW(), g.W / 2);
  assert.equal(g.camViewH(), g.H / 2);
});

test('zoom is clamped at both ends', () => {
  const { g } = load();
  g.camZoomTo(500);
  assert.equal(g.camZoom, g.CAM_MAX, 'cannot zoom past the limit');
  g.camZoomTo(0.01);
  assert.equal(g.camZoom, g.CAM_MIN, 'nor further out than the whole world');
});

test('zooming pins the point under the cursor', () => {
  const { g } = load();
  // The world point in the middle of the canvas before and after must match.
  const at = (fx, fy) => ({ x: g.camX + fx * g.camViewW(), y: g.camY + fy * g.camViewH() });
  g.camZoomTo(1.5, 0.5, 0.5);
  const before = at(0.5, 0.5);
  g.camZoomTo(3, 0.5, 0.5);
  const after = at(0.5, 0.5);
  assert.ok(Math.abs(before.x - after.x) < 1e-6, `${before.x} vs ${after.x}`);
  assert.ok(Math.abs(before.y - after.y) < 1e-6);
});

test('the view cannot be panned off the edge of the world', () => {
  const { g } = load();
  g.camZoomTo(2);
  g.camPanByPixels(100000, 100000);   // drag hard up-left
  assert.equal(g.camX, 0, 'stops at the left edge');
  assert.equal(g.camY, 0, 'stops at the top edge');

  g.camPanByPixels(-100000, -100000); // and hard the other way
  assert.equal(g.camX, g.W - g.camViewW(), 'stops at the right edge');
  assert.equal(g.camY, g.H - g.camViewH(), 'stops at the bottom edge');
});

test('fitting returns the whole battlefield', () => {
  const { g } = load();
  g.camZoomTo(4);
  g.camPanByPixels(-200, -200);
  g.camFit();
  assert.equal(g.camZoom, g.CAM_MIN);
  assert.equal(g.camX, 0);
  assert.equal(g.camY, 0);
});

test('a pointer maps to the world under it, wherever the camera is', () => {
  const h = load({ width: 1000, height: 620 });
  const { g } = h;
  const canvas = h.el('game');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: g.viewW, height: g.viewH });

  // Fitted: the middle of the canvas is the middle of the world.
  let p = g.eventToWorld({ clientX: g.viewW / 2, clientY: g.viewH / 2 });
  assert.ok(Math.abs(p.x - g.W / 2) < 1e-6, `${p.x}`);

  // Zoomed into the top-left quarter: the middle of the canvas is a quarter in.
  g.camZoomTo(2, 0, 0);
  p = g.eventToWorld({ clientX: g.viewW / 2, clientY: g.viewH / 2 });
  assert.ok(Math.abs(p.x - g.W / 4) < 1e-6, `${p.x} should be a quarter across`);
  assert.ok(Math.abs(p.y - g.H / 4) < 1e-6);
});

test('the camera never touches the simulation', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  g.wind = 0;

  const before = {
    terrain: Array.from(g.terrain),
    tanks: Array.from(g.tanks, t => [t.x, t.hp, t.angle, t.power]),
    wind: g.wind, W: g.W, H: g.H, physScale: g.physScale
  };

  g.camZoomTo(3.5, 0.2, 0.8);
  g.camPanByPixels(-120, 60);
  g.camCenterOn(700, 300);

  assert.deepEqual(Array.from(g.terrain), before.terrain, 'terrain untouched');
  assert.deepEqual(Array.from(g.tanks, t => [t.x, t.hp, t.angle, t.power]), before.tanks);
  assert.equal(g.wind, before.wind);
  assert.equal(g.W, before.W, 'the world keeps its size');
  assert.equal(g.H, before.H);
  assert.equal(g.physScale, before.physScale, 'and its physics');
});

test('two players zoomed differently still land a shot in the same place', () => {
  const shotLandsAt = (zoom) => {
    const h = loadFlat({ seed: 99 });
    const { g } = h;
    h.flatTerrain(400);
    h.placeTanksAt([200, 700]);
    g.wind = 0;
    g.camZoomTo(zoom);
    g.currentPlayer = 0;
    g.tanks[0].angle = 45;
    g.tanks[0].power = 65;
    g.state = 'AIMING';
    h.fireAndSettle();
    let lowest = 0;
    for (let x = 1; x < g.W; x++) if (g.terrain[x] > g.terrain[lowest]) lowest = x;
    return lowest;
  };
  assert.equal(shotLandsAt(1), shotLandsAt(4), 'zoom is a view, not a handicap');
});

test('the shell stays in view while it flies, once zoomed in', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([120, 880]);
  g.currentPlayer = 0;
  g.tanks[0].angle = 45;
  g.tanks[0].power = 80;
  g.state = 'AIMING';

  g.camZoomTo(3);
  h.advance(500); // the view settles on whoever is aiming, as it does in play

  g.fire();
  let sawItMove = false, lastShellX = null;
  for (let i = 0; i < 40 && g.projectiles.length; i++) {
    h.advance(50);
    const p = g.projectiles[0];
    if (!p) break;
    assert.ok(p.x >= g.camX - 1 && p.x <= g.camX + g.camViewW() + 1,
      `shell at ${p.x.toFixed(0)} left the view ${g.camX.toFixed(0)}..${(g.camX + g.camViewW()).toFixed(0)}`);
    if (lastShellX !== null && p.x > lastShellX) sawItMove = true;
    lastShellX = p.x;
    assert.ok(g.camX >= -1e-6 && g.camX <= g.W - g.camViewW() + 1e-6, 'and the view stays inside the world');
  }
  assert.ok(sawItMove, 'the shell actually travelled');
});

test('a deliberate pan is not yanked away, and is released on the next turn', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([120, 880]);
  g.camZoomTo(3);
  g.currentPlayer = 0;
  g.state = 'AIMING';

  g.camPanned = true;
  g.camCenterOn(880, 400);   // look at the far tank
  const looking = g.camX;
  g.camFollow(0.1);
  assert.equal(g.camX, looking, 'the view stays where it was put');

  g.camPanned = false;
  g.camFollow(1);
  assert.ok(g.camX < looking, 'and settles back on the active tank once released');
});

test('the view controls only offer what is actually possible', () => {
  const h = load();
  const { g } = h;

  g.camFit();
  // Nothing to zoom out of and nothing to fit: those two are not shown at all.
  assert.equal(h.el('zoom-out').hidden, true);
  assert.equal(h.el('zoom-fit').hidden, true);
  assert.equal(h.el('zoom-in').hidden, false);
  assert.equal(h.el('zoom-in').disabled, false);

  g.camZoomTo(2);
  assert.equal(h.el('zoom-out').hidden, false, 'they come back once zoomed');
  assert.equal(h.el('zoom-fit').hidden, false);

  g.camZoomTo(g.CAM_MAX);
  // "+" stays put, disabled: hiding it would slide "−" under a finger that is
  // already tapping "+", so the next tap would undo the zoom.
  assert.equal(h.el('zoom-in').hidden, false, 'still shown at the limit');
  assert.equal(h.el('zoom-in').disabled, true, 'but does nothing');
  assert.equal(h.el('zoom-out').disabled, false);
});
