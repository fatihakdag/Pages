// Turn order, win detection, and the control locking that keeps a player from
// reaching into a CPU seat's turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadFlat } from './harness.mjs';

function threeHumans() {
  const h = load();
  h.g.cpuMode = false;
  h.g.playerCount = 3;
  h.g.resetGame();
  h.flatTerrain(400);
  h.g.wind = 0;
  return h;
}

test('the turn passes to the next living seat and wraps around', () => {
  const h = threeHumans();
  const { g } = h;
  g.currentPlayer = 0;
  g.state = 'RESOLVED';

  g.nextTurn();
  assert.equal(g.currentPlayer, 1);
  g.nextTurn();
  assert.equal(g.currentPlayer, 2);
  g.nextTurn();
  assert.equal(g.currentPlayer, 0, 'wraps back to the first seat');
  assert.equal(g.state, 'AIMING');
});

test('dead seats are skipped', () => {
  const h = threeHumans();
  const { g } = h;
  g.tanks[1].alive = false;
  g.tanks[1].hp = 0;
  g.currentPlayer = 0;

  g.nextTurn();

  assert.equal(g.currentPlayer, 2);
});

test('each turn bumps the token that cancels a stale CPU shot', () => {
  const h = threeHumans();
  const { g } = h;
  const before = g.turnToken;
  g.nextTurn();
  assert.ok(g.turnToken > before);
});

test('a new turn rerolls the wind', () => {
  const h = threeHumans();
  const { g } = h;
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    g.nextTurn();
    seen.add(g.wind);
    assert.ok(Math.abs(g.wind) <= g.WIND_MAX, 'wind stays inside its cap');
  }
  assert.ok(seen.size > 1, 'the wind actually changes between turns');
});

test('wind readouts stay in their published range', () => {
  const h = threeHumans();
  const { g } = h;
  for (const w of [0, 20, -20, g.WIND_MAX, -g.WIND_MAX, g.WIND_MAX * 2]) {
    g.wind = w;
    assert.ok(g.windStrength() >= 0 && g.windStrength() <= 1);
    assert.ok(g.windForce() >= 0 && g.windForce() <= 10, 'players see a 0-10 force');
  }
  g.wind = 0;
  assert.equal(g.windForce(), 0, 'calm reads as zero');
});

test('the last tank standing ends the round', () => {
  const h = threeHumans();
  const { g } = h;
  g.tanks[0].alive = false;
  g.tanks[2].alive = false;

  assert.equal(g.endTurnCheckWin(), true);
  assert.equal(g.state, 'GAMEOVER');
  assert.equal(g.lastWinner, 1);
  assert.ok(g.el.overlay.classList.contains('show'), 'the win overlay is up');
});

test('a round with two or more alive keeps going', () => {
  const h = threeHumans();
  const { g } = h;
  g.tanks[2].alive = false;

  assert.equal(g.endTurnCheckWin(), false);
  assert.equal(g.state, 'AIMING');
});

test('a mutual wipeout reports no winner rather than crashing', () => {
  const h = threeHumans();
  const { g } = h;
  g.tanks.forEach(t => { t.alive = false; t.hp = 0; });

  assert.equal(g.endTurnCheckWin(), true);
  assert.equal(g.state, 'GAMEOVER');
  assert.equal(g.lastWinner, -1);
});

test('restarting gives everyone full hp, fresh ammo and a live round', () => {
  const h = threeHumans();
  const { g } = h;
  g.tanks[0].hp = 5;
  g.tanks[1].alive = false;
  g.state = 'GAMEOVER';

  g.resetGame();

  assert.equal(g.state, 'AIMING');
  assert.equal(g.currentPlayer, 0);
  assert.ok(g.tanks.every(t => t.hp === g.MAX_HP && t.alive));
  assert.ok(g.tanks.every(t => t.ammo.big === g.WEAPONS.big.startAmmo));
  assert.ok(!g.el.overlay.classList.contains('show'));
  assert.equal(g.projectiles.length, 0);
});

test('tanks start spread out across the map', () => {
  for (const count of [2, 3, 4]) {
    const h = load();
    h.g.cpuMode = false;
    h.g.playerCount = count;
    h.g.resetGame();
    const xs = Array.from(h.g.tanks, t => t.x).sort((a, b) => a - b);
    assert.equal(xs.length, count);
    for (let i = 1; i < xs.length; i++) {
      assert.ok(xs[i] - xs[i - 1] > h.g.TANK_W * 2, `${count} tanks: seats ${i - 1} and ${i} overlap`);
    }
    assert.ok(xs[0] >= 24 && xs[xs.length - 1] <= h.g.W - 24, 'nobody starts off the edge');
  }
});

test('a CPU turn locks every control a player could reach', () => {
  const h = loadFlat();
  const { g } = h;
  const el = g.el;
  g.cpuMode = true;
  g.currentPlayer = 1; // seat 2 is a CPU whenever cpuMode is on
  g.state = 'AIMING';

  g.syncControlsFromTank();

  assert.equal(el.fireBtn.disabled, true);
  assert.equal(el.angleSlider.disabled, true);
  assert.equal(el.powerSlider.disabled, true);
  assert.equal(el.weaponSelect.disabled, true, 'the weapon select is a turn control too');
  assert.ok(el.nudgeBtns.length > 0);
  assert.ok(Array.from(el.nudgeBtns).every(b => b.disabled), 'the aim arrows are locked');
  assert.equal(el.countSelect.disabled, true);
  assert.equal(el.modeSelect.disabled, true);
  assert.equal(el.difficultySelect.disabled, true);
});

test('a human turn leaves the controls live', () => {
  const h = loadFlat();
  const { g } = h;
  const el = g.el;
  g.cpuMode = true;
  g.currentPlayer = 0; // seat 1 is always the local human
  g.state = 'AIMING';

  g.syncControlsFromTank();

  assert.equal(el.fireBtn.disabled, false);
  assert.equal(el.angleSlider.disabled, false);
  assert.equal(el.powerSlider.disabled, false);
  assert.equal(el.weaponSelect.disabled, false);
  assert.ok(Array.from(el.nudgeBtns).every(b => !b.disabled));
});

test('the game settings are released once the round is over on a CPU seat', () => {
  const h = loadFlat();
  const { g } = h;
  const el = g.el;
  g.cpuMode = true;
  g.currentPlayer = 1;
  g.state = 'GAMEOVER';

  g.syncControlsFromTank();

  // You want to change the roster and difficulty before hitting Play Again,
  // and the round may well have ended on a CPU seat.
  assert.equal(el.countSelect.disabled, false);
  assert.equal(el.modeSelect.disabled, false);
  assert.equal(el.difficultySelect.disabled, false);
  assert.equal(el.fireBtn.disabled, true, 'but there is nothing to fire at');
});
