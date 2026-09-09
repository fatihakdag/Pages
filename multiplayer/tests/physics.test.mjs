// Shot physics: muzzle state, gravity, wind, and the width scaling that keeps
// a given angle/power landing on the same relative spot on any screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadFlat } from './harness.mjs';

function muzzle(g, t) {
  const a = t.angle * Math.PI / 180;
  return {
    x: t.x + 20 * Math.cos(a),
    y: g.groundHeightAt(t.x) - g.TANK_H - 20 * Math.sin(a)
  };
}

test('fire() only launches while aiming', () => {
  const h = loadFlat();
  const { g } = h;

  g.state = 'FIRING';
  g.fire();
  assert.equal(g.projectiles.length, 0, 'a shot already in the air blocks another');

  g.state = 'GAMEOVER';
  g.fire();
  assert.equal(g.projectiles.length, 0);

  g.state = 'AIMING';
  g.fire();
  assert.equal(g.projectiles.length, 1);
  assert.equal(g.state, 'FIRING');
});

test('the shell leaves the barrel at the aimed angle and power', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const t = g.tanks[0];
  t.angle = 30;
  t.power = 80;
  g.currentPlayer = 0;
  g.state = 'AIMING';

  g.fire();
  const [p] = g.projectiles;
  const m = muzzle(g, t);
  const speed = 80 * 6.2 * g.physScale;

  assert.ok(Math.abs(p.x - m.x) < 1e-6, 'starts at the muzzle, not the hull');
  assert.ok(Math.abs(p.y - m.y) < 1e-6);
  assert.ok(Math.abs(p.vx - Math.cos(Math.PI / 6) * speed) < 1e-6);
  assert.ok(Math.abs(p.vy + Math.sin(Math.PI / 6) * speed) < 1e-6, 'canvas y grows downward');
  assert.equal(p.firedBy, 0);
  assert.equal(p.weapon, 'standard');
});

test('a windless arc is symmetric about its apex', () => {
  const h = loadFlat();
  const { g } = h;
  g.wind = 0;
  const pts = g.traceShot(200, 400, 45, 60, 0);

  let apex = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[apex][1]) apex = i;

  const rise = pts[apex][0] - pts[0][0];
  const fall = pts[pts.length - 1][0] - pts[apex][0];
  assert.ok(Math.abs(rise - fall) / rise < 0.05, `climb ${rise} and descent ${fall} should match`);
  assert.ok(pts[apex][1] < pts[0][1], 'the shell actually gains height');
});

test('wind pushes the shell downwind', () => {
  const h = loadFlat();
  const { g } = h;
  const still = g.predictLandingX(200, 380, 45, 60, 0);
  const right = g.predictLandingX(200, 380, 45, 60, g.WIND_MAX);
  const left = g.predictLandingX(200, 380, 45, 60, -g.WIND_MAX);

  assert.ok(right > still, 'a rightward wind carries the shell further right');
  assert.ok(left < still, 'a leftward wind pulls it back');
  assert.ok(right - still > 20, 'full wind is worth aiming off for');
});

test('predictLandingX agrees with the finer traceShot integrator', () => {
  const h = loadFlat();
  const { g } = h;
  // Only shots that come down on the map: the two integrators stop at
  // different off-map bounds by design (-80 vs -20).
  for (const [angle, power, wind] of [[45, 60, 0], [70, 40, 0], [60, 50, 40], [30, 90, -60]]) {
    const pts = g.traceShot(200, 380, angle, power, wind);
    const traced = pts[pts.length - 1][0];
    const predicted = g.predictLandingX(200, 380, angle, power, wind);
    assert.ok(Math.abs(traced - predicted) < 20,
      `angle ${angle} power ${power}: traced ${traced.toFixed(1)} vs predicted ${predicted.toFixed(1)}`);
  }
});

test('the same shot lands on the same spot on every screen size', () => {
  // The property a match depends on: physics is in world units, so the canvas
  // it happens to be drawn on cannot change where a shell lands. (Physics used
  // to be scaled by canvas width, which made the landing point screen-dependent
  // and two players unable to share a world.)
  const landings = [400, 900, 1600].map(width => {
    const h = load({ width, height: 500 });
    const { g } = h;
    g.cpuMode = false;
    g.resetGame();
    h.flatTerrain(400);
    g.wind = 0;
    return g.predictLandingX(200, 380, 45, 60, 0);
  });

  for (const landed of landings) {
    assert.equal(landed, landings[0], `landing points differ across canvases: ${landings}`);
  }
  const range = landings[0] - 200;
  assert.ok(range > 0.3 * 1000, `a 60-power shot should carry across the world, went ${range}`);
});

test('wind bends the shell in flight, not just in the predictor', () => {
  // Fired for real through step(), so this covers the integrator the shell
  // actually flies on rather than the AI's predictor.
  const landingWith = (wind) => {
    const h = loadFlat({ seed: 3 });
    const { g } = h;
    h.flatTerrain(400);
    h.placeTanksAt([150, 850]);
    g.currentPlayer = 0;
    g.tanks[0].angle = 45;
    g.tanks[0].power = 55;
    g.state = 'AIMING';
    g.fire();
    g.wind = wind; // set after fire() so the muzzle state is identical
    h.advanceUntil(() => g.state === 'AIMING' || g.state === 'GAMEOVER');
    // the crater marks where it came down
    let lowest = 0;
    for (let x = 1; x < g.W; x++) if (g.terrain[x] > g.terrain[lowest]) lowest = x;
    return lowest;
  };

  const still = landingWith(0);
  const right = landingWith(80);
  const left = landingWith(-80);

  assert.ok(right > still + 10, `tailwind should carry it right: ${right} vs ${still}`);
  assert.ok(left < still - 10, `headwind should hold it back: ${left} vs ${still}`);
});

test('a shot that flies off the map ends the turn without an explosion', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 1;
  g.tanks[1].angle = 45;   // aimed right, off the edge of the map
  g.tanks[1].power = 100;
  g.state = 'AIMING';

  h.fireAndSettle();
  assert.equal(g.shotExploded, false, 'nothing detonated');
  assert.equal(g.currentPlayer, 0, 'the turn still moves on');
  // Array.from: values cross out of the vm context, and a vm-side Array fails
  // a deepStrictEqual prototype check.
  assert.deepEqual(Array.from(g.tanks, t => t.hp), [100, 100]);
});
