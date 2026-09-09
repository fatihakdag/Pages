// The weapon table, per-tank ammo, and the fallback to the standard shell when
// a weapon runs dry or is switched off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlat } from './harness.mjs';

test('every enabled weapon starts with ammo and the standard shell is unlimited', () => {
  const { g } = loadFlat();
  const ammo = g.freshAmmo();

  for (const key of Object.keys(g.WEAPONS)) {
    if (!g.weaponEnabled(key)) {
      assert.ok(!(key in ammo), `${key} is switched off and should have no ammo`);
      continue;
    }
    assert.equal(ammo[key], g.WEAPONS[key].startAmmo, `${key} starts on its table value`);
    assert.ok(ammo[key] > 0);
  }
  assert.equal(ammo.standard, Infinity, 'you can never be left unable to shoot');
});

test('every weapon has the fields the rest of the game reads', () => {
  const { g } = loadFlat();
  for (const [key, w] of Object.entries(g.WEAPONS)) {
    assert.ok(w.radius > 0, `${key} needs a blast radius`);
    assert.ok(w.damageMax > 0, `${key} needs damage`);
    assert.ok(typeof w.color === 'string' && w.color.startsWith('#'), `${key} needs a colour`);
    assert.ok(typeof w.label === 'string' && w.label.length, `${key} needs a label`);
  }
});

test('weaponAvailable is false once a weapon is spent or disabled', () => {
  const { g } = loadFlat();
  const t = g.tanks[0];

  assert.equal(g.weaponAvailable(t, 'big'), true);
  t.ammo.big = 0;
  assert.equal(g.weaponAvailable(t, 'big'), false);
  assert.equal(g.weaponAvailable(t, 'standard'), true, 'the standard shell never runs out');
  assert.equal(g.weaponAvailable(t, 'nonsense'), false);
});

test('firing spends a round from the shooter alone', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  g.tanks[0].weapon = 'big';
  const before = g.tanks[1].ammo.big;

  g.fire();

  assert.equal(g.tanks[0].ammo.big, g.WEAPONS.big.startAmmo - 1);
  assert.equal(g.tanks[1].ammo.big, before, "the other seat's ammo is untouched");
  assert.equal(g.projectiles[0].weapon, 'big');
});

test('spending the last round hands the tank back to the standard shell', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  const t = g.tanks[0];
  t.weapon = 'mirv';
  t.ammo.mirv = 1;

  g.fire();

  assert.equal(t.ammo.mirv, 0);
  assert.equal(t.weapon, 'standard', 'the next turn must not open on an empty weapon');
  assert.equal(g.projectiles[0].weapon, 'mirv', 'the shot that was paid for still goes out');
});

test('firing an empty weapon falls back to the standard shell', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  const t = g.tanks[0];
  t.weapon = 'cluster';
  t.ammo.cluster = 0;

  g.fire();

  assert.equal(g.projectiles[0].weapon, 'standard');
  assert.equal(t.ammo.cluster, 0, 'ammo cannot go negative');
});

test('the guided missile switch reaches the weapon table', () => {
  const { g } = loadFlat();
  // One flag in MISSILE is meant to govern the whole weapon.
  assert.equal(g.WEAPONS.missile.enabled, g.MISSILE.enabled);
  assert.equal(g.weaponEnabled('missile'), g.MISSILE.enabled);
});

test('a disabled weapon leaves the ammo table and the dropdown', () => {
  const h = loadFlat();
  const { g } = h;
  g.WEAPONS.big.enabled = false;
  try {
    assert.equal(g.weaponEnabled('big'), false);
    assert.ok(!('big' in g.freshAmmo()), 'no ammo is handed out for it');

    g.pruneWeaponOptions();
    const values = Array.from(g.el.weaponSelect.options, o => o.value);
    assert.ok(!values.includes('big'), 'the option is dropped from the select');
    assert.ok(values.includes('standard'));
  } finally {
    g.WEAPONS.big.enabled = true;
  }
});

test('the dropdown lists exactly the enabled weapons', () => {
  const { g } = loadFlat();
  const values = Array.from(g.el.weaponSelect.options, o => o.value);
  const enabled = Object.keys(g.WEAPONS).filter(k => g.weaponEnabled(k));
  assert.deepEqual(values, enabled);
});
