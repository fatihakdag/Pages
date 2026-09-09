// The CPU: how well it solves a shot, what it is allowed to fire, and the
// guards that stop a deferred shot from landing in someone else's turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

function cpuGame(opts = {}) {
  const h = load(opts);
  const { g } = h;
  g.cpuMode = true;
  g.aiDifficulty = opts.difficulty ?? 'brutal';
  g.resetGame();
  h.flatTerrain(400);
  g.wind = 0;
  g.tanks.forEach(t => { t.hp = 100; t.alive = true; });
  g.state = 'AIMING';
  return h;
}

test('brutal solves a flat, windless shot onto the target', () => {
  const h = cpuGame();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 1;
  h.fixRandom(0.99); // no jitter branch, no helicopter hunt

  const shot = g.chooseAiShot('brutal');
  const a = shot.angle * Math.PI / 180;
  const landing = g.predictLandingX(
    g.tanks[1].x, g.groundHeightAt(g.tanks[1].x) - g.TANK_H - 20 * Math.sin(a),
    shot.angle, shot.power, 0);

  assert.ok(Math.abs(landing - g.tanks[0].x) < g.TANK_W * 2,
    `brutal missed by ${Math.abs(landing - g.tanks[0].x).toFixed(1)}px`);
});

test('the solution comes back as whole, in-range numbers', () => {
  const h = cpuGame();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 1;

  // A brutal solve sweeps thousands of trajectories, so keep the sample small.
  for (const difficulty of ['easy', 'medium', 'hard', 'brutal']) {
    for (let i = 0; i < 3; i++) {
      const shot = g.chooseAiShot(difficulty);
      assert.equal(shot.angle, Math.round(shot.angle), `${difficulty} angle must be whole`);
      assert.equal(shot.power, Math.round(shot.power), `${difficulty} power must be whole`);
      assert.ok(shot.angle >= 5 && shot.angle <= 175, `${difficulty} angle ${shot.angle} out of range`);
      assert.ok(shot.power >= 10 && shot.power <= 100, `${difficulty} power ${shot.power} out of range`);
    }
  }
});

test('the harder the level, the tighter the grouping', () => {
  const h = cpuGame();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 1;

  const spread = (difficulty) => {
    h.seedRandom(7);
    const errs = [];
    for (let i = 0; i < 12; i++) {
      const shot = g.chooseAiShot(difficulty);
      const a = shot.angle * Math.PI / 180;
      const landing = g.predictLandingX(
        g.tanks[1].x, g.groundHeightAt(g.tanks[1].x) - g.TANK_H - 20 * Math.sin(a),
        shot.angle, shot.power, 0);
      errs.push(Math.abs(landing - g.tanks[0].x));
    }
    return errs.reduce((s, e) => s + e, 0) / errs.length;
  };

  const easy = spread('easy');
  const brutal = spread('brutal');
  assert.ok(brutal < easy, `brutal (${brutal.toFixed(0)}px) should group tighter than easy (${easy.toFixed(0)}px)`);
});

test('an unknown difficulty falls back to medium rather than throwing', () => {
  const h = cpuGame();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 1;
  const shot = g.chooseAiShot('nonsense');
  assert.ok(Number.isFinite(shot.angle) && Number.isFinite(shot.power));
});

test('the CPU never shells itself', () => {
  const h = cpuGame();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 1;
  h.fixRandom(0.99);

  const shot = g.chooseAiShot('brutal');
  const a = shot.angle * Math.PI / 180;
  const landing = g.predictLandingX(
    g.tanks[1].x, g.groundHeightAt(g.tanks[1].x) - g.TANK_H - 20 * Math.sin(a),
    shot.angle, shot.power, 0);
  assert.ok(Math.abs(landing - g.tanks[1].x) >= g.TANK_W, 'solved a shot into its own lap');
});

test('a CPU seat thinks, aims and fires on its own', () => {
  const h = cpuGame();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 1;
  g.state = 'AIMING';

  g.maybeAiTurn();
  assert.equal(g.state, 'AIMING', 'it does not fire instantly');

  h.advance(3000);
  assert.notEqual(g.state, 'AIMING', 'the CPU took its shot');
});

test('a CPU shot deferred from a turn that has moved on is dropped', () => {
  const h = cpuGame();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 1;
  g.state = 'AIMING';

  g.maybeAiTurn();
  // The turn ends underneath it — a helicopter crash can do exactly this.
  g.nextTurn();
  const seat = g.currentPlayer;
  h.advance(3000);

  assert.equal(g.currentPlayer, seat, 'the stale shot did not fire for the current seat');
  assert.equal(g.projectiles.length, 0);
});

test('a human seat is never played for by the CPU', () => {
  const h = cpuGame();
  const { g } = h;
  g.currentPlayer = 0; // seat 1 is the local human
  g.state = 'AIMING';

  g.maybeAiTurn();
  h.advance(3000);

  assert.equal(g.state, 'AIMING', 'the human tank fired by itself');
  assert.equal(g.projectiles.length, 0);
});

test('the CPU only picks weapons it can actually fire', () => {
  const h = cpuGame({ difficulty: 'easy' }); // a cheap solve; the pick logic is the same
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const cpu = g.tanks[1];
  // everything spent except the standard shell
  for (const key of Object.keys(cpu.ammo)) if (key !== 'standard') cpu.ammo[key] = 0;

  for (let i = 0; i < 8; i++) {
    g.currentPlayer = 1;
    g.state = 'AIMING';
    cpu.weapon = 'standard';
    g.maybeAiTurn();
    h.advance(2000);
    assert.equal(cpu.weapon, 'standard', 'the CPU reached for a weapon it had no rounds for');
    g.projectiles = [];
    g.state = 'AIMING';
  }
});

test('the CPU never reaches for the guided missile', () => {
  const h = cpuGame({ difficulty: 'hard' });
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const cpu = g.tanks[1];

  // Its aim comes from a ballistic predictor that knows nothing about the
  // missile's burn, so picking one would mean undershooting every time.
  const picked = new Set();
  for (let i = 0; i < 12; i++) {
    g.currentPlayer = 1;
    g.state = 'AIMING';
    Object.keys(cpu.ammo).forEach(k => { cpu.ammo[k] = cpu.ammo[k] === Infinity ? Infinity : 5; });
    g.maybeAiTurn();
    h.advance(2000);
    picked.add(cpu.weapon);
    g.projectiles = [];
    g.state = 'AIMING';
  }

  assert.ok(!picked.has('missile'), `CPU picked: ${[...picked].join(', ')}`);
  assert.ok(picked.size > 1, 'it should still vary its weapon');
});
