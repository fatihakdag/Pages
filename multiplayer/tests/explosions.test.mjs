// Where things go off: a shell stops at the first thing in its path, so a
// burst against a cliff face happens on the face and not on top of the cliff,
// and cluster bomblets and roller mines respect the same walls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlat } from './harness.mjs';

const shell = (over = {}) => ({ x: 0, y: 0, vx: 0, vy: 0, firedBy: 0, trail: [], ...over });

// Flat ground at 400 with a sheer cliff rising to `top` from x = `at` onward.
function cliff(h, at = 500, top = 200) {
  h.flatTerrain(400);
  for (let x = at; x < h.g.W; x++) h.g.terrain[x] = top;
}

test('a shell flying into a cliff face bursts on the face, not on top', () => {
  const h = loadFlat();
  const { g } = h;
  cliff(h);
  h.placeTanksAt([100, 900]);
  const p = shell({ x: 470, y: 320, vx: 500, vy: 0, weapon: 'standard' });
  g.projectiles = [p];
  g.state = 'FIRING';

  g.stepProjectile(p, 0.1);

  assert.equal(p.dead, true);
  const e = g.explosions[g.explosions.length - 1];
  assert.ok(e.x <= 500 && e.x > 495, `burst at x ${e.x.toFixed(1)}, the face is at 500`);
  assert.ok(Math.abs(e.y - 320) < 8, `burst at y ${e.y.toFixed(1)}, not on the cliff top at 200`);
  assert.ok(g.terrain[505] > 320, 'the blast bit into the face at the height it hit');
});

test('a fast shell cannot step over a thin peak', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  g.terrain[500] = g.terrain[501] = 200;
  h.placeTanksAt([100, 900]);
  const p = shell({ x: 470, y: 300, vx: 600, vy: 0, weapon: 'standard' });
  g.projectiles = [p];
  g.state = 'FIRING';

  g.stepProjectile(p, 0.1); // 60px in one frame, straight through x = 500

  assert.equal(p.dead, true);
  assert.equal(g.shotExploded, true);
});

test('a cluster bomb throws its bomblets up out of the crater', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([200, 800]);
  const p = shell({ x: 500, y: 395, vx: 0, vy: 200, weapon: 'cluster' });
  g.projectiles = [p];
  g.state = 'FIRING';

  // The first frame has no elapsed time; bomblets join the flight the frame after impact.
  h.advanceUntil(() => g.projectiles.some(q => q.bomblet), { maxMs: 200 });

  const n = g.WEAPONS.cluster.clusterCount;
  assert.equal(g.projectiles.length, n);
  assert.ok(g.projectiles.every(q => q.bomblet && q.vy < 0), 'all thrown upward');
  assert.ok(g.projectiles.every(q => Math.abs(q.x - 500) < 20), 'from the impact point');
  const vxs = Array.from(g.projectiles, q => q.vx).sort((a, b) => a - b);
  assert.ok(vxs[0] < 0 && vxs[n - 1] > 0, 'fanned both ways');
});

test('cluster bomblets burst and the turn still ends', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 0;
  g.tanks[0].weapon = 'cluster';
  g.tanks[0].angle = 45;
  g.tanks[0].power = 60;
  g.state = 'AIMING';

  h.fireAndSettle();

  assert.equal(g.projectiles.length, 0, 'every bomblet came down');
  assert.equal(g.currentPlayer, 1, 'and the turn moved on');
});

test('a cluster bomb at the foot of a cliff never bursts on top of it', () => {
  const h = loadFlat();
  const { g } = h;
  cliff(h, 520, 150);
  h.placeTanksAt([100, 900]);
  const p = shell({ x: 500, y: 395, vx: 0, vy: 200, weapon: 'cluster' });
  g.projectiles = [p];
  g.state = 'FIRING';

  h.advanceUntil(() => g.state === 'AIMING' || g.state === 'GAMEOVER');

  // The bomblets only rise ~70px; nothing can reach a cliff top 250px up. Any
  // column of it was either left alone or bitten from the face, well below.
  for (let x = 520; x < 880; x++) {
    assert.ok(g.terrain[x] === 150 || g.terrain[x] > 300,
      `cliff column ${x} was carved from the top, down to ${g.terrain[x].toFixed(0)}`);
  }
});

test('a roller does not ride up a vertical wall', () => {
  const h = loadFlat();
  const { g } = h;
  cliff(h, 500, 250);
  h.placeTanksAt([100, 900]);
  const p = shell({ x: 470, y: 400, vx: 150, weapon: 'roller', rolling: true, rollTime: 0 });
  g.projectiles = [p];

  for (let i = 0; i < 200 && !p.dead; i++) g.stepRoller(p, 0.05);

  assert.equal(p.dead, true);
  assert.ok(p.x < 500, `it stopped at the foot of the wall, got to ${p.x.toFixed(0)}`);
  const e = g.explosions[g.explosions.length - 1];
  assert.ok(e.y > 350, 'and went off down there');
});

test('a roller that hits a cliff face in flight drops to its foot', () => {
  const h = loadFlat();
  const { g } = h;
  cliff(h, 500, 200);
  h.placeTanksAt([100, 900]);
  const p = shell({ x: 470, y: 300, vx: 400, vy: 0, weapon: 'roller' });
  g.projectiles = [p];
  g.state = 'FIRING';

  for (let i = 0; i < 60 && !p.rolling && !p.dead; i++) g.stepProjectile(p, 0.03);

  assert.equal(p.rolling, true, 'it settled');
  assert.ok(p.x < 500 && p.y === 400, `on the low ground, at ${p.x.toFixed(0)},${p.y}`);
});

test('a roller that runs off a ledge falls and settles below', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  for (let x = 0; x < 500; x++) g.terrain[x] = 250; // a shelf that ends at 500
  h.placeTanksAt([100, 900]);
  const p = shell({ x: 480, y: 250, vx: 120, weapon: 'roller', rolling: true, rollTime: 0 });
  g.projectiles = [p];
  g.state = 'FIRING';

  h.advanceUntil(() => p.dead || (p.rolling && p.y === 400), { maxMs: 3000 });

  assert.ok(p.y === 400 || (p.dead && g.explosions.at(-1).y > 350),
    'it ended up on the ground below the ledge, not hovering at its lip');
});

test('a burst at a tank\'s tracks counts as close as one on its roof', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const t = g.tanks[1];

  g.applyDamageAndCrater(t.x, g.groundHeightAt(t.x), 'standard');

  assert.ok(Math.abs(t.hp - (100 - g.WEAPONS.standard.damageMax)) < 1e-6);
});
