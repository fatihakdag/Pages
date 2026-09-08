// Blast damage: falloff, the kill threshold, and the ordering rule that damage
// is measured against the ground as it was before the crater was dug.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlat } from './harness.mjs';

// Blast damage is measured to the top of the hull, which is where the shell
// would have had to land for a direct hit.
function tankTop(g, t) {
  return g.groundHeightAt(t.x) - g.TANK_H;
}

test('a direct hit does the weapon\'s full damage', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const t = g.tanks[1];

  g.applyDamageAndCrater(t.x, tankTop(g, t), 'standard');

  assert.ok(Math.abs(t.hp - (100 - g.WEAPONS.standard.damageMax)) < 1e-6);
  assert.equal(g.tanks[0].hp, 100, 'the far tank is untouched');
});

test('damage falls off linearly to the edge of the blast', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const t = g.tanks[1];
  const w = g.WEAPONS.standard;
  const offset = w.radius / 2;

  g.applyDamageAndCrater(t.x - offset, tankTop(g, t), 'standard');

  assert.ok(Math.abs((100 - t.hp) - w.damageMax * 0.5) < 0.5,
    `half-radius hit should do about half damage, did ${(100 - t.hp).toFixed(1)}`);
});

test('nothing outside the blast radius takes damage', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const t = g.tanks[1];

  g.applyDamageAndCrater(t.x - g.WEAPONS.standard.radius - 1, tankTop(g, t), 'standard');

  assert.equal(t.hp, 100);
});

test('a bigger weapon hits harder and wider', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const big = g.WEAPONS.big;
  const std = g.WEAPONS.standard;

  assert.ok(big.damageMax > std.damageMax);
  assert.ok(big.radius > std.radius);

  const t = g.tanks[1];
  const reach = std.radius + 4; // outside a standard blast, inside a big one
  g.applyDamageAndCrater(t.x - reach, tankTop(g, t), 'big');
  assert.ok(t.hp < 100, 'the big bomb reaches past a standard shell');
});

test('hp clamps at zero and the tank is marked dead', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const t = g.tanks[1];
  t.hp = 10;

  g.applyDamageAndCrater(t.x, tankTop(g, t), 'big');

  assert.equal(t.hp, 0, 'hp never goes negative');
  assert.equal(t.alive, false);
});

test('a dead tank is not damaged again', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const t = g.tanks[1];
  t.alive = false;
  t.hp = 0;

  g.applyDamageAndCrater(t.x, tankTop(g, t), 'big');
  assert.equal(t.hp, 0);
});

test('damage is measured before the crater moves the ground', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const t = g.tanks[1];
  const groundBefore = g.groundHeightAt(t.x);

  g.applyDamageAndCrater(t.x, tankTop(g, t), 'standard');

  // The crater digs the ground out from under the tank; if damage were computed
  // afterwards the same hit would read as a distant one and under-credit.
  assert.ok(g.groundHeightAt(t.x) > groundBefore, 'the hit did carve the ground');
  assert.ok(Math.abs(t.hp - (100 - g.WEAPONS.standard.damageMax)) < 1e-6,
    'full damage survived the cratering');
});

test('one blast can catch several tanks at once', () => {
  const h = loadFlat();
  const { g } = h;
  g.playerCount = 3;
  g.resetGame();
  h.flatTerrain(400);
  h.placeTanksAt([400, 420, 800]);

  g.applyDamageAndCrater(410, tankTop(g, g.tanks[0]), 'big');

  assert.ok(g.tanks[0].hp < 100);
  assert.ok(g.tanks[1].hp < 100);
  assert.equal(g.tanks[2].hp, 100);
});

test('a shell landing on a tank actually damages it end to end', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 0;
  const t = g.tanks[0];
  t.weapon = 'standard';

  // Solve with traceShot: it runs the same integrator step() does, so the
  // solved shot is the shot that actually flies.
  let best = null;
  for (let angle = 20; angle <= 80; angle += 0.5) {
    for (let power = 20; power <= 100; power += 0.5) {
      const a = angle * Math.PI / 180;
      const x0 = t.x + 20 * Math.cos(a);
      const y0 = g.groundHeightAt(t.x) - g.TANK_H - 20 * Math.sin(a);
      const pts = g.traceShot(x0, y0, angle, power, 0);
      const err = Math.abs(pts[pts.length - 1][0] - g.tanks[1].x);
      if (!best || err < best.err) best = { angle, power, err };
    }
  }
  t.angle = best.angle;
  t.power = best.power;
  g.state = 'AIMING';

  h.fireAndSettle();

  assert.ok(g.tanks[1].hp < 100, `solved shot should hit (predicted miss ${best.err.toFixed(1)}px)`);
  assert.equal(g.shotExploded, true);
  assert.equal(g.currentPlayer, 1, 'and the turn passes on');
});

test('a shell coming down on a tank damages it through the normal step loop', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const target = g.tanks[1];

  g.projectiles = [{
    x: target.x, y: g.groundHeightAt(target.x) - g.TANK_H - 40,
    vx: 0, vy: 120, weapon: 'standard', firedBy: 0, trail: []
  }];
  g.state = 'FIRING';
  h.advanceUntil(() => g.state === 'AIMING' || g.state === 'GAMEOVER');

  // Not quite damageMax: the hull hit registers a few pixels off the top of
  // the tank, which is far enough in to count as point blank but not zero.
  assert.ok(target.hp < 100 - g.WEAPONS.standard.damageMax * 0.8,
    `a shell dropped onto the hull should be close to a direct hit, took ${(100 - target.hp).toFixed(1)}`);
});
