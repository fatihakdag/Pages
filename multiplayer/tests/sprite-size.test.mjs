// TANK SIZE in Settings: on a small screen tanks and shells are drawn larger
// than the world's scale ('large', the default), or kept to it ('actual').
// Either way it is drawing only — the world is the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

test('Large is the default, and grows sprites only where the world is drawn small', () => {
  const phone = load({ width: 390, height: 600 });
  const desk = load({ width: 1600, height: 1000 });
  assert.equal(phone.g.sizePref, 'large');
  assert.equal(phone.g.el.sizeSelect.value, 'large');

  const b = phone.g.spriteBoost();
  assert.ok(b > 1, `a phone-sized canvas is boosted (got ${b})`);
  assert.ok(b <= phone.g.SPRITE_MAX_BOOST);
  // The floor is the point: drawn size never falls under SPRITE_MIN_PX per unit.
  assert.ok(phone.g.viewScale * b >= phone.g.SPRITE_MIN_PX - 1e-9 || b === phone.g.SPRITE_MAX_BOOST);

  assert.equal(desk.g.spriteBoost(), 1, 'a desktop canvas is left alone');
});

test('Actual keeps everything to scale, and the choice is remembered', () => {
  const { g, ctx } = load({ width: 390, height: 600 });
  g.el.sizeSelect.value = 'actual';
  g.el.sizeSelect.dispatch('change');
  assert.equal(g.sizePref, 'actual');
  assert.equal(g.spriteBoost(), 1);
  assert.equal(ctx.localStorage.getItem('barrage.tankSize'), 'actual');

  g.el.sizeSelect.value = 'large';
  g.el.sizeSelect.dispatch('change');
  assert.ok(g.spriteBoost() > 1);
  assert.equal(ctx.localStorage.getItem('barrage.tankSize'), 'large');
});

test('the stored choice is restored, and an unknown one falls back to Large', () => {
  const { g, ctx } = load({ width: 390, height: 600 });
  ctx.localStorage.setItem('barrage.tankSize', 'actual');
  g.initSizePref();
  assert.equal(g.sizePref, 'actual');
  assert.equal(g.el.sizeSelect.value, 'actual');

  ctx.localStorage.setItem('barrage.tankSize', 'huge');
  g.initSizePref();
  assert.equal(g.sizePref, 'large');
  assert.equal(g.el.sizeSelect.value, 'large');
});

test('switching size does not touch the world', () => {
  const { g } = load({ width: 390, height: 600 });
  const before = { terrain: Array.from(g.terrain), tanks: g.tanks.map(t => [t.x, t.hp]), W: g.W, H: g.H };
  g.el.sizeSelect.value = 'actual';
  g.el.sizeSelect.dispatch('change');
  g.render();
  assert.deepEqual(Array.from(g.terrain), before.terrain);
  assert.deepEqual(g.tanks.map(t => [t.x, t.hp]), before.tanks);
  assert.equal(g.W, before.W);
  assert.equal(g.H, before.H);
});

test('the setting has Turkish labels', () => {
  const { g } = load();
  g.el.langCheckbox.checked = true;
  g.el.langCheckbox.dispatch('change');
  for (const key of ['tankSize', 'sizeLarge', 'sizeActual']) {
    assert.notEqual(g.txt(key), load().g.txt(key), `${key} has no Turkish entry`);
  }
});
