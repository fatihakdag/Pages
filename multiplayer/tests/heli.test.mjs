// The helicopter: its hit box, the wreck that follows, and the rule that it
// does not leave until everyone has had a shot at it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlat } from './harness.mjs';

test('the hit box tracks the airframe', () => {
  const h = loadFlat();
  const { g } = h;
  g.spawnHeli();
  g.heli.x = 500;
  g.heli.y = 200;
  const w = g.heliSize();

  assert.equal(g.heliHitBy(500, 200), true, 'dead centre');
  assert.equal(g.heliHitBy(500 + w * 0.4, 200), true, 'along the fuselage');
  assert.equal(g.heliHitBy(500 + w, 200), false, 'well past the nose');
  assert.equal(g.heliHitBy(500, 200 + w), false, 'well below it');
});

test('a helicopter already falling cannot be hit again', () => {
  const h = loadFlat();
  const { g } = h;
  g.spawnHeli();
  g.heli.x = 500;
  g.heli.y = 200;
  g.heli.falling = true;

  assert.equal(g.heliHitBy(500, 200), false);
});

test('a shell that reaches the airframe brings it down', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  g.spawnHeli();
  g.heli.x = 500;
  g.heli.y = 200;

  const p = { x: 500, y: 200, vx: 0, vy: -10, weapon: 'standard', firedBy: 0, trail: [] };
  g.projectiles = [p];
  g.state = 'FIRING';
  g.stepProjectile(p, 0.02);

  assert.equal(p.dead, true, 'the shell bursts on the airframe');
  assert.equal(g.heli.falling, true);
  assert.equal(g.shotExploded, true);
});

test('the wreck crushes whatever it lands on and blasts what is nearby', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  g.playerCount = 3;
  g.resetGame();
  h.flatTerrain(400);
  h.placeTanksAt([400, 450, 800]);
  g.tanks.forEach(t => { t.hp = 100; t.alive = true; });
  g.state = 'FIRING'; // mid-shot, so the crash does not try to resolve the turn

  g.heliCrash(400, g.groundHeightAt(400));

  assert.equal(g.tanks[0].alive, false, 'a direct landing destroys the tank outright');
  assert.ok(g.tanks[1].hp < 100 && g.tanks[1].hp > 0, 'a near miss takes heavy damage');
  assert.equal(g.tanks[2].hp, 100, 'the far tank is clear');
});

test('a crash that ends the round is resolved on the spot', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([400, 800]);
  g.currentPlayer = 0;
  g.state = 'AIMING';

  g.heliCrash(800, g.groundHeightAt(800)); // lands on the only opponent

  assert.equal(g.tanks[1].alive, false);
  assert.equal(g.state, 'GAMEOVER');
  assert.equal(g.lastWinner, 0);
});

test('a crash that kills the seat whose turn it is hands the turn on', () => {
  const h = loadFlat();
  const { g } = h;
  g.playerCount = 3;
  g.resetGame();
  h.flatTerrain(400);
  h.placeTanksAt([200, 500, 800]);
  g.tanks.forEach(t => { t.hp = 100; t.alive = true; });
  g.currentPlayer = 1;
  g.state = 'AIMING';

  g.heliCrash(500, g.groundHeightAt(500));

  assert.equal(g.tanks[1].alive, false);
  assert.notEqual(g.currentPlayer, 1, 'the dead seat does not keep the turn');
  assert.equal(g.state, 'AIMING');
});

test('the helicopter stays until every living seat has seen it', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  g.state = 'AIMING';
  g.currentPlayer = 0;
  g.spawnHeli();
  const w = g.heliSize();

  // Seat 1 has not had a turn while it is up, so it must come back for another pass.
  g.heli.x = g.heli.dir > 0 ? g.W + w * 2 : -w * 2;
  g.updateHeli(0.016);
  assert.notEqual(g.heli, null, 'it turned around instead of leaving');
  assert.equal(g.heli.legs, 1);

  // Once everyone has seen it, it leaves after its minimum number of passes.
  g.tanks.forEach((t, i) => g.heli.seen.add(i));
  for (let leg = 0; leg < 6 && g.heli; leg++) {
    g.heli.x = g.heli.dir > 0 ? g.W + w * 2 : -w * 2;
    g.updateHeli(0.016);
  }
  assert.equal(g.heli, null, 'it eventually goes home');
});

test('a falling helicopter comes down and detonates on the ground', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  g.state = 'FIRING';
  g.spawnHeli();
  g.heli.x = 450;
  g.heli.y = 200;
  g.heli.falling = true;
  g.heli.vy = 20;

  const landed = h.advanceUntil(() => g.heli === null, { maxMs: 8000 });
  assert.ok(landed, 'the wreck should reach the ground');
  assert.ok(g.terrain[450] > 400, 'and leave a crater where it hit');
});

test('summoning is ignored once the round is over', () => {
  const h = loadFlat();
  const { g } = h;
  g.heli = null;
  g.state = 'GAMEOVER';

  g.summonHeli();

  assert.equal(g.heli, null);
});

test('only one helicopter is up at a time', () => {
  const h = loadFlat();
  const { g } = h;
  g.state = 'AIMING';
  g.heli = null;

  g.summonHeli();
  const first = g.heli;
  g.summonHeli();

  assert.equal(g.heli, first);
});

test('the wreck\'s blast is measured to the whole hull, not just its roof', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  g.state = 'FIRING';
  const t = g.tanks[1];

  g.heliCrash(t.x + 40, g.groundHeightAt(t.x)); // on the ground beside the tracks

  assert.ok(Math.abs(t.hp - (100 - 80 * (1 - 40 / 74))) < 1e-6,
    `took ${(100 - t.hp).toFixed(2)}, expected the blast at 40px`);
});

test('a wreck crashing beside a ledge does not crush the tank up on it', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  for (let x = 380; x <= 420; x++) g.terrain[x] = 250; // a pillar with a tank on top
  h.placeTanksAt([400, 900]);
  g.state = 'FIRING';
  const t = g.tanks[0];

  g.heliCrash(425, 400); // at its foot: 25px across, 150px down

  assert.equal(t.alive, true, 'only a wreck that comes down on a tank crushes it');
  assert.equal(t.hp, 100, 'and 150px below the hull is outside the blast');
});

test('a wreck falling into a cliff face goes off on the face, not on top', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  for (let x = 500; x < g.W; x++) g.terrain[x] = 200;
  h.placeTanksAt([100, 850]);
  g.state = 'FIRING';
  g.spawnHeli();
  Object.assign(g.heli, { x: 470, y: 300, vy: 0, dir: 1, speed: 3000, falling: true });

  g.updateHeli(0.05); // ~52px sideways in one frame, straight into the face

  assert.equal(g.heli, null, 'it crashed');
  const e = g.explosions[g.explosions.length - 1];
  assert.ok(e.x <= 500, `burst at x ${e.x.toFixed(1)}, the face is at 500`);
  assert.ok(e.y > 280 && e.y < 320, `burst at y ${e.y.toFixed(1)}, not on the cliff top at 200`);
});
