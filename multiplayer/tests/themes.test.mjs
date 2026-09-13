// The theme picker in Settings: random by default, a fixed environment once
// chosen, remembered across reloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

test('the theme select lists Random and then every theme, in THEMES order', () => {
  const { g } = load();
  const values = Array.from(g.el.themeSelect.options, o => o.value);
  assert.deepEqual(values, ['random', ...Array.from(g.THEMES, t => t.name)]);
});

test('every theme has a Turkish name', () => {
  const { g } = load();
  g.el.langCheckbox.checked = true;
  g.el.langCheckbox.dispatch('change');
  assert.equal(g.lang, 'tr');
  // txt() falls back to the English entry and then to the key, so a missing
  // Turkish name would quietly come back as the English one.
  for (const t of g.THEMES) {
    assert.notEqual(g.txt(t.name), t.name, `${t.name} has no Turkish name`);
  }
  assert.notEqual(g.txt('randomTheme'), 'Random');
});

test('Random is the default and rolls a different environment every round', () => {
  const { g } = load();
  assert.equal(g.themePref, 'random');
  assert.equal(g.el.themeSelect.value, 'random');
  const seen = new Set();
  let prev = g.theme;
  for (let i = 0; i < 30; i++) {
    g.resetGame();
    assert.notEqual(g.theme, prev, 'never the same environment twice in a row');
    prev = g.theme;
    seen.add(g.theme.name);
  }
  assert.ok(seen.size > 3, `only saw ${[...seen]}`);
});

test('a chosen theme is applied at once and kept on every new round', () => {
  const { g, ctx } = load();
  g.el.themeSelect.value = 'Lunar Base';
  g.el.themeSelect.dispatch('change');
  assert.equal(g.theme.name, 'Lunar Base', 'offline the pick shows immediately');
  for (let i = 0; i < 5; i++) {
    g.resetGame();
    assert.equal(g.theme.name, 'Lunar Base');
  }
  assert.equal(ctx.localStorage.getItem('barrage.theme'), 'Lunar Base');
});

test('the stored choice is restored, and an unknown one falls back to Random', () => {
  const { g, ctx } = load();
  ctx.localStorage.setItem('barrage.theme', 'Glacier');
  g.initTheme();
  assert.equal(g.el.themeSelect.value, 'Glacier');
  g.resetGame();
  assert.equal(g.theme.name, 'Glacier');

  ctx.localStorage.setItem('barrage.theme', 'Atlantis');
  g.initTheme();
  assert.equal(g.themePref, 'random');
  assert.equal(g.el.themeSelect.value, 'random');
});

test('Sandstorm is rolling dunes: smooth, a few crests, slip faces steeper than windward slopes', () => {
  const { g } = load();
  g.el.themeSelect.value = 'Sandstorm';
  g.el.themeSelect.dispatch('change');
  for (let round = 0; round < 10; round++) {
    const shape = Array.from(g.generateTerrainShape());
    // no jagged steps between neighbouring points
    for (let i = 1; i < shape.length; i++) {
      assert.ok(Math.abs(shape[i] - shape[i - 1]) < 0.05, `step at ${i}`);
    }
    // crests are local minima (0 = high ground)
    const crests = [];
    for (let i = 1; i < shape.length - 1; i++) {
      if (shape[i] < shape[i - 1] && shape[i] <= shape[i + 1]) crests.push(i);
    }
    assert.ok(crests.length >= 2 && crests.length <= 6, `${crests.length} crests`);
    // one side of every full dune is steeper, and it is the same side for all
    const sides = crests.map(c => {
      let l = c; while (l > 0 && shape[l - 1] > shape[l]) l--;
      let r = c; while (r < shape.length - 1 && shape[r + 1] > shape[r]) r++;
      return { left: c - l, right: r - c, full: l > 0 && r < shape.length - 1 };
    }).filter(s => s.full);
    const steepRight = sides.map(s => s.right < s.left);
    assert.ok(steepRight.every(v => v === steepRight[0]), 'slip faces all face one way');
  }
});

test('Lunar Base is cratered ground under a black sky with Earth in it', () => {
  const h = load();
  const { g } = h;
  g.el.themeSelect.value = 'Lunar Base';
  g.el.themeSelect.dispatch('change');
  assert.equal(g.theme.shape, 'craters');
  assert.ok(g.theme.planet);
  for (let round = 0; round < 10; round++) {
    const shape = Array.from(g.generateTerrainShape());
    assert.equal(shape.length, g.theme.points);
    assert.ok(shape.every(v => v >= 0.05 && v <= 0.85), 'stays inside the terrain bounds');
  }
  g.resetGame();
  assert.equal(g.theme.name, 'Lunar Base');
  // Rendering the sky, Earth included, must not throw.
  h.advance(100);
  assert.ok(Array.from(g.terrain).every(Number.isFinite));
});

test('going back to Random lets the rounds vary again', () => {
  const { g } = load();
  g.el.themeSelect.value = 'Sandstorm';
  g.el.themeSelect.dispatch('change');
  g.el.themeSelect.value = 'random';
  g.el.themeSelect.dispatch('change');
  g.resetGame();
  assert.notEqual(g.theme.name, 'Sandstorm');
});
