// The helicopter: its hit box, the wreck that follows, and the rule that it
// does not leave until everyone has had a shot at it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlat, routeHeli } from './harness.mjs';

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
  g.heli = g.heliIn(routeHeli(g, { x: g.W, speed: 300, seen: [0] }));

  // Seat 1 has not had a turn while it is up, so it comes back for another pass.
  h.advance(1000);
  assert.ok(g.heli, 'it turned around instead of leaving');
  assert.equal(g.heli.legs, 1);
  assert.equal(g.heli.dir, -1);

  // Seat 1's turn comes round: now everyone has had a go, so this leg is its last.
  g.advanceTurn(false);
  assert.equal(g.heli.legsTotal, 2, 'it finishes the leg it is on, two legs at least');
  assert.ok(h.advanceUntil(() => g.heli === null, { maxMs: 10000 }), 'and then goes home');
});

test('left alone, it flies its maximum legs and goes', () => {
  const h = loadFlat();
  const { g } = h;
  g.state = 'AIMING';
  g.heli = g.heliIn(routeHeli(g, { x: 0, speed: 1000, seen: [0] }));
  let legs = 0;
  h.advanceUntil(() => { if (g.heli) legs = Math.max(legs, g.heli.legs); return g.heli === null; }, { maxMs: 20000 });
  assert.equal(g.heli, null);
  assert.equal(legs + 1, g.HELI_MAX_LEGS);
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

test('the turn is not over until a shot-down wreck has landed', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([150, 850]);
  g.currentPlayer = 0;
  // The frame after a shell burst on the airframe, high up: the fall takes
  // well over the 0.9s the shell's own blast holds the turn for.
  g.spawnHeli();
  Object.assign(g.heli, { x: 500, y: 60, dir: 1, speed: 60, falling: true, vy: 20 });
  g.projectiles = [];
  g.state = 'FIRING';

  assert.ok(h.advanceUntil(() => g.heli === null || g.currentPlayer !== 0, { maxMs: 8000 }));
  assert.equal(g.heli, null, 'the wreck lands first');
  assert.equal(g.currentPlayer, 0, 'still inside the shooter’s turn');

  h.advanceUntil(() => g.state === 'AIMING');
  assert.equal(g.currentPlayer, 1, 'and only then does play move on');
});

test('it is drawn where the clock says, the same distance every frame', () => {
  const h = loadFlat();
  const { g } = h;
  g.state = 'AIMING';
  g.heli = g.heliIn(routeHeli(g));

  // 7ms frames against 1/60s steps.
  const drawn = [];
  for (let i = 0; i < 40; i++) { h.advance(7, 7); drawn.push(g.heliDrawPos().x); }
  const moves = drawn.slice(1).map((x, i) => x - drawn[i]);
  assert.ok(moves.every(d => Math.abs(d - 60 * 0.007) < 1e-6),
    `the same distance every frame: ${moves.map(d => d.toFixed(3)).join(' ')}`);
});

test('news of the helicopter it already has does not move it', () => {
  const h = loadFlat();
  const { g } = h;
  g.state = 'AIMING';
  const route = routeHeli(g);
  g.heli = g.heliIn(route);
  h.advance(700);
  const before = g.heliDrawPos();

  // However late it arrives, the same route puts it in the same place now.
  g.netReceive({ k: 'heli', heli: route, heliTimer: 90 });
  assert.deepEqual(g.heliDrawPos(), before);
});

test('where it is follows from the route and the time alone, turnarounds included', () => {
  const { g } = loadFlat();
  const route = routeHeli(g, { x: 900, speed: 200 });
  const w = g.heliSize();
  const T = route.t0 + (g.W + w * 2.5) / 200 + 0.5;   // half a second into the second leg
  const at = g.heliRouteAt(route, T);
  assert.equal(at.legs, 1);
  assert.equal(at.dir, -1, 'heading back');
  assert.ok(Math.abs(at.x - (g.W + w * 1.5 - 100)) < 1e-9, 'having come back in over the edge it left by');
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

// On the moon it is a spaceship: a different body and a different sustained
// sound, and nothing else. The simulation is not allowed to notice.
test('an airless theme flies a spaceship, and only the drawing and the sound change', () => {
  const h = loadFlat();
  const { g } = h;

  assert.equal(g.isShipTheme(), false, 'the default theme still flies a helicopter');
  const heliBox = g.heliSize();

  g.el.themeSelect.value = 'Lunar Base';
  g.el.themeSelect.dispatch('change');
  assert.equal(g.isShipTheme(), true);
  assert.equal(g.heliSize(), heliBox, 'same size, so the hit box is unchanged');

  g.spawnHeli();
  g.heli.x = 500;
  g.heli.y = 200;
  assert.equal(g.heliHitBy(500, 200), true, 'still hit the same way');

  // Both the flying ship and the wreck have to draw without throwing.
  g.drawHeli();
  g.heli.falling = true;
  g.heli.spin = 0.4;
  g.drawHeli();
});

test('the spaceship is a voice of its own, and the two never sound at once', () => {
  const h = loadFlat();
  const { g } = h;

  // No Web Audio in the stub DOM, so what is checked here is that the frame
  // loop drives both voices every frame without throwing and leaves nothing
  // sustained behind — the leak the rotor was always one call site away from.
  g.el.themeSelect.value = 'Lunar Base';
  g.el.themeSelect.dispatch('change');
  g.spawnHeli();
  g.updateSoundLoops();
  assert.equal(g.Sound.loops(), 0);

  g.el.themeSelect.value = 'Sandstorm';
  g.el.themeSelect.dispatch('change');
  g.updateSoundLoops();
  assert.equal(g.Sound.loops(), 0);
  assert.deepEqual(Array.from(g.Sound.loopNames()), []);
});
