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

// ---------- The picker under the dropdown ----------

test('every weapon the dropdown offers has a button and an icon', () => {
  const { g } = loadFlat();
  const offered = [...g.el.weaponSelect.options].map(o => o.value);

  assert.deepEqual([...g.weaponButtons.keys()], offered,
    'the row is built from the options, so the two cannot disagree');
  for (const key of offered) {
    assert.ok(g.WEAPON_ICONS[key], `${key} needs an icon`);
    assert.match(g.WEAPON_ICONS[key], /^<svg /, `${key}'s icon should be inline SVG`);
  }
});

test('the picker shows what is in stock and rings what is selected', () => {
  const h = loadFlat();
  const { g } = h;
  const t = g.tanks[g.currentPlayer];
  g.syncWeaponOptions(t);

  const shown = () => [...g.weaponButtons].filter(([, b]) => !b.hidden).map(([k]) => k);
  const ringed = () => [...g.weaponButtons]
    .filter(([, b]) => b.classList.contains('is-selected')).map(([k]) => k);

  assert.deepEqual(ringed(), ['standard'], 'the opening weapon is marked');
  assert.ok(shown().includes('big'));

  // Spending a weapon takes it out of the row rather than greying it out.
  t.ammo.big = 0;
  g.syncWeaponOptions(t);
  assert.ok(!shown().includes('big'), 'a spent weapon leaves the row');
  assert.ok(g.weaponButtons.get('big').hidden);
});

test('tapping an icon arms that weapon for the tank whose turn it is', () => {
  const h = loadFlat();
  const { g } = h;
  const t = g.tanks[g.currentPlayer];

  g.weaponButtons.get('mirv').dispatch('click');

  assert.equal(t.weapon, 'mirv', 'the choice belongs to the tank, as with the dropdown');
  assert.equal(g.el.weaponSelect.value, 'mirv', 'and the dropdown agrees');
  assert.equal(g.weaponButtons.get('mirv').getAttribute('aria-pressed'), 'true');
  assert.equal(g.weaponButtons.get('standard').getAttribute('aria-pressed'), 'false');
});

test('a weapon with nothing left cannot be armed by tapping it', () => {
  const h = loadFlat();
  const { g } = h;
  const t = g.tanks[g.currentPlayer];
  t.ammo.cluster = 0;
  g.syncWeaponOptions(t);

  g.weaponButtons.get('cluster').dispatch('click');

  assert.equal(t.weapon, 'standard', 'the tap is ignored rather than arming an empty weapon');
});

test('the picker is out of reach on a seat you are not playing', () => {
  const h = loadFlat();
  const { g } = h;
  const t = g.tanks[g.currentPlayer];
  // weaponSelect.disabled is the game's existing answer to "is this choice
  // yours", set for a CPU seat and for somebody else's seat online.
  g.el.weaponSelect.disabled = true;

  g.weaponButtons.get('big').dispatch('click');

  assert.equal(t.weapon, 'standard', 'reaching into a CPU seat changes nothing');
});

test('the buttons are labelled with the weapon and what is left of it', () => {
  const h = loadFlat();
  const { g } = h;
  const t = g.tanks[g.currentPlayer];
  t.ammo.big = 4;
  g.syncWeaponOptions(t);

  assert.equal(g.weaponButtons.get('big').getAttribute('aria-label'),
    `${g.txt('w_big')} (4)`);
  assert.equal(g.weaponButtons.get('standard').getAttribute('aria-label'),
    g.txt('w_standard'), 'the unlimited one carries no count');
});
