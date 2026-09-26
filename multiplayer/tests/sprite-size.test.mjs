// TANK SIZE in Settings: on a small screen tanks and shells are drawn larger
// than the world's scale ('large', the default), or kept to it ('actual').
// Either way it is drawing only — the world is the same.
//
// The option is switched off for now (TANK_SIZE.option): every tank is drawn
// at its true size and the setting is hidden. The tests of the option itself
// switch it on, so it is still known to work when it comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

/** A game with the TANK SIZE option switched back on. */
function loadOn(opts) {
  const h = load(opts);
  h.g.TANK_SIZE.option = true;
  h.g.initSizePref();
  h.g.resize();
  return h;
}

test('switched off: true size everywhere, no setting, and a stored choice kept', () => {
  const { g, ctx } = load({ width: 390, height: 600 });
  assert.equal(g.TANK_SIZE.option, false);
  assert.equal(g.sizePref, 'actual');
  assert.equal(g.spriteBoost(), 1, 'a phone is drawn at the world\u2019s own scale');
  assert.equal(g.el.sizeGroup.style.display, 'none', 'and Settings does not offer it');

  ctx.localStorage.setItem('barrage.tankSize', 'large');
  g.initSizePref();
  assert.equal(g.sizePref, 'actual', 'a stored Large does not come back while it is off');
  g.el.sizeSelect.value = 'large';
  g.el.sizeSelect.dispatch('change');
  assert.equal(g.spriteBoost(), 1);
  assert.equal(ctx.localStorage.getItem('barrage.tankSize'), 'large', 'nor is it thrown away');
});

test('Large is the default, and grows sprites only where the world is drawn small', () => {
  const phone = loadOn({ width: 390, height: 600 });
  const desk = loadOn({ width: 1600, height: 1000 });
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
  const { g, ctx } = loadOn({ width: 390, height: 600 });
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
  const { g, ctx } = loadOn({ width: 390, height: 600 });
  ctx.localStorage.setItem('barrage.tankSize', 'actual');
  g.initSizePref();
  assert.equal(g.sizePref, 'actual');
  assert.equal(g.el.sizeSelect.value, 'actual');

  ctx.localStorage.setItem('barrage.tankSize', 'huge');
  g.initSizePref();
  assert.equal(g.sizePref, 'large');
  assert.equal(g.el.sizeSelect.value, 'large');
});

test('the option is only offered where it changes anything, and follows a resize', () => {
  const phone = loadOn({ width: 390, height: 600 });
  assert.equal(phone.g.el.sizeGroup.style.display, '', 'shown on a phone');

  const h = loadOn({ width: 1600, height: 1000 });
  assert.equal(h.g.el.sizeGroup.style.display, 'none', 'hidden where the world is drawn full size');

  // A desktop window narrowed to phone width draws the world small again.
  h.el('game-wrap').getBoundingClientRect = () => ({ width: 390, height: 600 });
  h.el('game').getBoundingClientRect = () => ({ width: 390, height: 600 });
  h.g.resize();
  assert.ok(h.g.viewScale < h.g.SPRITE_MIN_PX);
  assert.equal(h.g.el.sizeGroup.style.display, '', 'offered again once it matters');
});

test('switching size does not touch the world', () => {
  const { g } = loadOn({ width: 390, height: 600 });
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
