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

test('the CPU reaches for the guided missile now and then', () => {
  const h = cpuGame({ difficulty: 'hard' });
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const cpu = g.tanks[1];

  const picked = new Set();
  for (let i = 0; i < 30 && !picked.has('missile'); i++) {
    g.currentPlayer = 1;
    g.state = 'AIMING';
    Object.keys(cpu.ammo).forEach(k => { cpu.ammo[k] = cpu.ammo[k] === Infinity ? Infinity : 5; });
    cpu.ammo.jet = 0;   // a jet left in the sky would keep the missile racked
    g.maybeAiTurn();
    h.advance(2000);
    picked.add(cpu.weapon);
    g.projectiles = [];
    g.state = 'AIMING';
  }

  assert.ok(picked.has('missile'), `CPU picked: ${[...picked].join(', ')}`);
  assert.ok(picked.size > 1, 'it should still vary its weapon');
});

test('the CPU leaves the missile in its rack while an aircraft is up', () => {
  const h = cpuGame({ difficulty: 'hard' });
  const { g } = h;
  h.placeTanksAt([200, 700]);
  const cpu = g.tanks[1];
  // Every roll lands on the missile's slice of the table.
  h.fixRandom(0.99);
  g.spawnHeli();

  g.currentPlayer = 1;
  g.state = 'AIMING';
  cpu.weapon = 'standard';
  g.maybeAiTurn();
  h.advance(1000);
  assert.equal(cpu.weapon, 'standard', 'a missile fired now would chase the helicopter');
});

test('the missile is aimed more loosely than a shell', () => {
  const h = cpuGame({ difficulty: 'hard' });
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 1;
  // At the top of every jitter roll, and clear of the wide-miss branch.
  h.fixRandom(0.99);
  const shell = g.chooseAiShot('hard', 'standard');
  const missile = g.chooseAiShot('hard', 'missile');
  h.fixRandom(0.5);
  const solved = g.chooseAiShot('hard', 'standard');   // no jitter at all

  const off = (shot) => Math.abs(shot.angle - solved.angle) + Math.abs(shot.power - solved.power);
  assert.ok(off(missile) > off(shell) * 1.4,
    `missile off by ${off(missile)}, shell by ${off(shell)}`);
});

test('brutal out-shoots hard but is not a sure thing', () => {
  const h = cpuGame();
  const { g } = h;
  const R = g.WEAPONS.standard.radius;
  const rate = (difficulty) => {
    h.seedRandom(11);
    let hits = 0, n = 0;
    for (const pos of [[150, 500], [200, 700], [300, 650]]) {
      for (let k = 0; k < 10; k++) {
        h.placeTanksAt(pos);
        g.currentPlayer = 1;
        const shot = g.chooseAiShot(difficulty);
        const a = shot.angle * Math.PI / 180;
        const landing = g.predictLandingX(
          g.tanks[1].x, g.groundHeightAt(g.tanks[1].x) - g.TANK_H - 20 * Math.sin(a),
          shot.angle, shot.power, 0);
        if (Math.abs(landing - g.tanks[0].x) < R) hits++;
        n++;
      }
    }
    return hits / n;
  };
  const hard = rate('hard');
  const brutal = rate('brutal');
  assert.ok(brutal > hard, `brutal (${brutal}) should land in range more often than hard (${hard})`);
  assert.ok(brutal < 1, 'brutal should still miss now and then');
});

// ---------- The jet ----------

/** A Hard or Brutal CPU (seat 1) on flat ground, about to pick its weapon. */
function jetGame(difficulty = 'brutal') {
  const h = cpuGame({ difficulty });
  const { g } = h;
  h.placeTanksAt([700, 200]);
  g.heliDue = g.netNow() + 1e6;
  g.currentPlayer = 1;
  g.state = 'AIMING';
  return h;
}

test('Hard and Brutal call a jet in and drop its bombs on their target', () => {
  for (const difficulty of ['hard', 'brutal']) {
    const h = jetGame(difficulty);
    const { g } = h;
    g.DIFFICULTY_SETTINGS[difficulty].jetJitter = 0;   // the moment it aims for
    h.queueRandom([0.99]);                             // the jet's slice of the table
    g.maybeAiTurn();
    h.advanceUntil(() => g.jet, { maxMs: 3000 });
    assert.ok(g.jet, `${difficulty} called a jet in`);
    assert.equal(g.jet.seat, 1);
    assert.equal(g.jet.fromLeft, true, 'it flies from its own side (x 200) toward the target (x 700)');
    assert.equal(g.tanks[1].ammo.jet, g.WEAPONS.jet.startAmmo - 1, 'the round is spent');

    h.advanceUntil(() => g.state !== 'AIMING', { maxMs: 15000 });
    assert.equal(g.projectiles.length, g.JET.bombs, 'it let the stick go');
    h.advanceUntil(() => g.state === 'AIMING' || g.state === 'GAMEOVER', { maxMs: 20000 });
    assert.ok(g.tanks[0].hp < 100 - g.WEAPONS.jet.damageMax, `${difficulty} did ${100 - g.tanks[0].hp}`);
    assert.equal(g.tanks[1].hp, 100);
  }
});

test('the drop it plans puts the middle bomb on the target', () => {
  const h = jetGame();
  const { g } = h;
  g.wind = g.WIND_MAX * 0.6;
  g.tanks[1].angle = 120;
  g.callInJet(1);
  const T = g.planJetDrop(g.tanks[0]);
  const at = g.jetRouteAt(g.jet, T);
  const vx = at.dir * g.jet.speed;
  const held = Math.floor(g.JET.bombs / 2) * g.JET.bombGapSteps * g.SIM_DT;
  const land = g.predictBombX(at.x + vx * held, g.jet.y + g.jetSize() * 0.12, vx, g.wind);
  assert.ok(Math.abs(land - g.tanks[0].x) < 4, `lands at ${land.toFixed(1)}`);
});

test('Easy and Medium never call a jet in', () => {
  for (const difficulty of ['easy', 'medium']) {
    const h = jetGame(difficulty);
    const { g } = h;
    h.fixRandom(0.99);   // the far end of every table
    g.maybeAiTurn();
    h.advance(2000);
    assert.equal(g.jet, null, difficulty);
    assert.equal(g.tanks[1].ammo.jet, g.WEAPONS.jet.startAmmo);
  }
});

test('no jet while the helicopter is up', () => {
  const h = jetGame('hard');
  const { g } = h;
  g.spawnHeli();
  h.fixRandom(0.99);
  g.maybeAiTurn();
  h.advance(1000);
  assert.equal(g.jet, null);
  assert.equal(g.tanks[1].weapon, 'standard');
});

test('a CPU jet held behind a dialog through its pass: the turn is played without it', () => {
  const h = jetGame();
  const { g } = h;
  h.queueRandom([0.99]);
  g.maybeAiTurn();
  h.advanceUntil(() => g.jet, { maxMs: 3000 });
  g.el.settingsBtn.dispatch('click');
  h.advanceUntil(() => !g.jet, { maxMs: 15000 });
  assert.equal(g.state, 'AIMING', 'nothing dropped behind the panel');
  assert.equal(g.currentPlayer, 1);

  g.closeDialog();
  h.advanceUntil(() => g.state !== 'AIMING', { maxMs: 15000 });
  assert.notEqual(g.projectiles.length, 0, 'it fires something else instead');
  assert.ok(g.projectiles.every(p => p.weapon !== 'jet'));
});
