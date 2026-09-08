// The controls and readouts: per-seat weapon state, aim nudging, the HUD
// banner, and the language switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlat } from './harness.mjs';

test('the weapon select is restored from whoever is aiming', () => {
  const h = loadFlat();
  const { g } = h;
  g.tanks[0].weapon = 'big';
  g.tanks[1].weapon = 'roller';

  g.currentPlayer = 0;
  g.syncControlsFromTank();
  assert.equal(g.el.weaponSelect.value, 'big');

  g.currentPlayer = 1;
  g.syncControlsFromTank();
  assert.equal(g.el.weaponSelect.value, 'roller', 'the select follows the seat, not the last pick');
});

test('the sliders show the aiming seat\'s angle and power', () => {
  const h = loadFlat();
  const { g } = h;
  g.tanks[1].angle = 120;
  g.tanks[1].power = 33;
  g.currentPlayer = 1;

  g.syncControlsFromTank();

  assert.equal(Number(g.el.angleSlider.value), 120);
  assert.equal(Number(g.el.powerSlider.value), 33);
});

test('ammo counts are shown per weapon and empty ones are greyed out', () => {
  const h = loadFlat();
  const { g } = h;
  const t = g.tanks[0];
  t.ammo.big = 0;
  t.ammo.cluster = 2;
  g.currentPlayer = 0;

  g.syncWeaponOptions(t);

  const byValue = Object.fromEntries(Array.from(g.el.weaponSelect.options, o => [o.value, o]));
  assert.equal(byValue.big.disabled, true, 'an empty weapon cannot be picked');
  assert.ok(byValue.cluster.textContent.includes('2'), 'the count is on the option');
  assert.equal(byValue.standard.disabled, false);
  assert.ok(byValue.standard.textContent.includes('∞'), 'the standard shell reads as unlimited');
});

test('a seat holding a weapon it has run out of falls back to the shell', () => {
  const h = loadFlat();
  const { g } = h;
  const t = g.tanks[0];
  t.weapon = 'mirv';
  t.ammo.mirv = 0;

  g.syncWeaponOptions(t);

  assert.equal(t.weapon, 'standard');
  assert.equal(g.el.weaponSelect.value, 'standard');
  assert.ok(g.el.ammoReadout.textContent.length > 0, 'the readout says something');
});

test('the aim arrows step angle and power inside their limits', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  const t = g.tanks[0];

  t.angle = 90;
  g.nudge('angle', 1);
  assert.equal(t.angle, 91);
  g.nudge('angle', -2);
  assert.equal(t.angle, 89);

  t.angle = 180;
  g.nudge('angle', 5);
  assert.equal(t.angle, 180, 'angle stops at 180');
  t.angle = 0;
  g.nudge('angle', -5);
  assert.equal(t.angle, 0, 'and at 0');

  t.power = 100;
  g.nudge('power', 5);
  assert.equal(t.power, 100, 'power stops at 100');
  t.power = 0;
  g.nudge('power', -5);
  assert.equal(t.power, 0);

  assert.equal(Number(g.el.angleSlider.value), t.angle, 'the slider follows the arrows');
});

test('dragging the angle slider aims the current tank', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;

  g.el.angleSlider.value = '77';
  g.el.angleSlider.dispatch('input');

  assert.equal(g.tanks[0].angle, 77);
});

test('the banner says whose turn it is, and what the round is doing', () => {
  const h = loadFlat();
  const { g } = h;
  const banner = g.el.turnBanner;

  g.cpuMode = false;
  g.currentPlayer = 0;
  g.state = 'AIMING';
  g.updateHUD();
  assert.ok(banner.textContent.includes('AIM'), banner.textContent);

  g.state = 'FIRING';
  g.updateHUD();
  assert.equal(banner.textContent, g.txt('inFlight'));

  g.state = 'GAMEOVER';
  g.updateHUD();
  assert.equal(banner.textContent, g.txt('roundOver'));

  g.cpuMode = true;
  g.currentPlayer = 1;
  g.state = 'AIMING';
  g.updateHUD();
  assert.ok(banner.textContent.includes('THINKING'), banner.textContent);
});

test('hp readouts follow the tanks', () => {
  const h = loadFlat();
  const { g } = h;
  g.tanks[0].hp = 42.4;

  g.updateHUD();

  assert.equal(g.el.hpText[0].textContent, `42 / ${g.MAX_HP}`);
  assert.ok(g.el.cards[0].classList.contains('active') || g.currentPlayer !== 0);
  assert.equal(g.el.cards[g.tanks.length].hidden, true, 'unused player cards stay hidden');
});

test('every string has a Turkish translation', () => {
  const h = loadFlat();
  const { g } = h;
  g.el.langCheckbox.checked = true;
  g.el.langCheckbox.dispatch('change');

  assert.equal(g.lang, 'tr');
  for (const key of ['fire', 'roundOver', 'inFlight', 'unlimited', 'w_standard', 'playerName']) {
    assert.notEqual(g.txt(key), '', `${key} is missing in Turkish`);
  }
  assert.equal(g.txt('w_standard'), 'Standart Mermi');
});

test('Turkish upper-casing keeps the dotted i', () => {
  const h = loadFlat();
  const { g } = h;
  g.el.langCheckbox.checked = true;
  g.el.langCheckbox.dispatch('change');

  // toUpperCase() would turn "Bilgisayar" into "BILGISAYAR" with a dotless I.
  assert.equal(g.upper('Bilgisayar'), 'BİLGİSAYAR');
});

test('the language choice is remembered', () => {
  const h = loadFlat();
  const { g } = h;
  g.el.langCheckbox.checked = true;
  g.el.langCheckbox.dispatch('change');

  assert.equal(h.ctx.window.localStorage.getItem('barrage.lang'), 'tr');
});
