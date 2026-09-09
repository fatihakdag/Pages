// The weapons that do something other than fly straight and explode: the
// roller mine, the MIRV, the cluster bomb and the guided missile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlat } from './harness.mjs';

const shell = (over = {}) => ({ x: 0, y: 0, vx: 0, vy: 0, firedBy: 0, trail: [], ...over });

test('a roller lands, settles on the ground and rolls instead of bursting', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  const p = shell({ x: 400, y: 380, vx: 60, vy: 200, weapon: 'roller' });
  g.projectiles = [p];
  g.state = 'FIRING';

  g.stepProjectile(p, 0.1);

  assert.equal(p.rolling, true, 'it settles rather than detonating on impact');
  assert.equal(p.dead, undefined);
  assert.equal(g.shotExploded, false);
});

test('a roller runs downhill', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(300);
  for (let x = 0; x < g.W; x++) g.terrain[x] = 300 + x * 0.5; // ground falls to the right
  h.placeTanksAt([50, 880]);
  const p = shell({ x: 400, y: g.groundHeightAt(400), weapon: 'roller', rolling: true, rollTime: 0 });

  const startX = p.x;
  for (let i = 0; i < 20 && !p.dead; i++) g.stepRoller(p, 0.05);

  assert.ok(p.x > startX, 'the mine rolled toward the low ground');
});

test('a roller detonates when it reaches a tank', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(300);
  for (let x = 0; x < g.W; x++) g.terrain[x] = 300 + x * 0.5;
  h.placeTanksAt([50, 500]);
  g.levelTankPads();
  const target = g.tanks[1];
  const p = shell({ x: 400, y: g.groundHeightAt(400), weapon: 'roller', rolling: true, rollTime: 0 });

  for (let i = 0; i < 80 && !p.dead; i++) g.stepRoller(p, 0.05);

  assert.equal(p.dead, true);
  assert.ok(target.hp < 100, 'the mine went off on the tank it rolled into');
});

test('a roller that stalls on flat ground gives up and detonates', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([100, 800]);
  const p = shell({ x: 450, y: 400, weapon: 'roller', rolling: true, rollTime: 0, vx: 5 });

  for (let i = 0; i < 200 && !p.dead; i++) g.stepRoller(p, 0.05);

  assert.equal(p.dead, true, 'it must not roll forever');
  assert.equal(g.shotExploded, true);
});

test('a MIRV splits at the apex into a spread of warheads', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  const w = g.WEAPONS.mirv;
  const p = shell({ x: 400, y: 200, vx: 100, vy: -1, weapon: 'mirv', age: 1 });
  g.projectiles = [p];
  g.state = 'FIRING';

  // Driven through step() rather than stepProjectile() directly: the split
  // warheads are held in a queue and only join the flight on the next frame.
  h.advance(48);

  assert.equal(p.dead, true, 'the parent warhead is spent');
  assert.equal(g.projectiles.length, w.mirvCount);
  assert.ok(g.projectiles.every(q => q.split), 'and the warheads cannot split again');
  const vxs = Array.from(g.projectiles, q => q.vx).sort((a, b) => a - b);
  assert.ok(vxs[vxs.length - 1] - vxs[0] > w.mirvSpread, 'the warheads fan out');
});

test('a flat MIRV shot does not split in the shooter\'s lap', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  // angle 0: vy starts at zero, so the apex test is true from the first frame.
  const p = shell({ x: 200, y: 380, vx: 300, vy: 0, weapon: 'mirv', age: 0 });
  g.projectiles = [p];
  g.state = 'FIRING';

  g.stepProjectile(p, 0.05);

  assert.notEqual(p.dead, true, 'the age floor keeps it together off the muzzle');
});

test('a cluster bomb queues sub-explosions on impact', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  const p = shell({ x: 500, y: 399, vx: 0, vy: 200, weapon: 'cluster' });
  g.projectiles = [p];
  g.state = 'FIRING';

  g.stepProjectile(p, 0.05);

  assert.equal(p.dead, true);
  assert.equal(g.clusterQueue.length, g.WEAPONS.cluster.clusterCount);
  assert.ok(g.clusterQueue.every(c => c.delay >= 0), 'the bomblets go off in sequence');
});

test('cluster bomblets go off and the turn still ends', () => {
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

  assert.equal(g.clusterQueue.length, 0, 'every bomblet resolved');
  assert.equal(g.currentPlayer, 1, 'and the turn moved on');
});

test('a guided missile lights its motor at the apex', (t) => {
  const h = loadFlat();
  const { g } = h;
  if (!g.weaponEnabled('missile')) return t.skip('guided missile is switched off');
  h.flatTerrain(400);
  const p = shell({ x: 300, y: 150, vx: 120, vy: -1, weapon: 'missile', age: 1, aimX: 700 });
  g.projectiles = [p];
  g.state = 'FIRING';

  g.stepProjectile(p, 0.05);

  assert.equal(p.armed, true);
  assert.ok(p.burnLeft > 0, 'the motor has fuel');
  assert.ok(p.burnSpeed > 0);
  assert.equal(p.chase, false, 'nothing to chase with no helicopter up');
});

test('a guided missile comes down near the spot the same shell would have hit', (t) => {
  const h = loadFlat();
  const { g } = h;
  if (!g.weaponEnabled('missile')) return t.skip('guided missile is switched off');
  h.flatTerrain(400);
  h.placeTanksAt([150, 850]);
  g.currentPlayer = 0;
  const shooter = g.tanks[0];
  shooter.weapon = 'missile';
  shooter.angle = 55;
  shooter.power = 70;
  g.state = 'AIMING';

  g.fire();
  const aimX = g.projectiles[0].aimX;
  assert.ok(aimX > shooter.x, 'the aim point is downrange');

  h.advanceUntil(() => g.state === 'AIMING' || g.state === 'GAMEOVER');

  // The crater is where it actually came down.
  let lowest = 0;
  for (let x = 1; x < g.W; x++) if (g.terrain[x] > g.terrain[lowest]) lowest = x;
  assert.ok(Math.abs(lowest - aimX) < 120,
    `missile landed at ${lowest}, aim point was ${aimX.toFixed(0)}`);
});

test('a guided missile chases a helicopter that is up when the motor lights', (t) => {
  const h = loadFlat();
  const { g } = h;
  if (!g.weaponEnabled('missile')) return t.skip('guided missile is switched off');
  h.flatTerrain(400);
  g.spawnHeli();
  g.heli.x = 600;
  g.heli.y = 200;

  const p = shell({ x: 300, y: 150, vx: 120, vy: -1, weapon: 'missile', age: 1, aimX: 700 });
  g.projectiles = [p];
  g.state = 'FIRING';
  g.stepProjectile(p, 0.05);

  assert.equal(p.chase, true);

  // A helicopter that leaves mid-burn drops it back into its dive rather than
  // flying at a target that is not there.
  g.heli = null;
  for (let i = 0; i < 10; i++) g.stepProjectile(p, 0.03);
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});
