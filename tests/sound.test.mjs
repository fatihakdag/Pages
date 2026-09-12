// The sound layer. Effects are synthesised in the browser through Web Audio,
// which the stub DOM does not have — so what these cover is the half that has
// to hold up anyway: that a machine with no Web Audio stays silent instead of
// throwing, and that nothing sustained is left running when a round ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlat } from './harness.mjs';

test('the game runs silently where there is no Web Audio', () => {
  const { g } = loadFlat();

  assert.equal(g.soundAvailable(), false, 'the stub DOM has no AudioContext');
  assert.equal(g.Sound.voices(), 0);
  assert.equal(g.Sound.loops(), 0);
});

test('every voice is a no-op rather than a throw when audio is unavailable', () => {
  const { g } = loadFlat();

  // If any of these throw, they take the frame loop down with them.
  g.Sound.fire(50);
  g.Sound.explode(26);
  g.Sound.destroyed();
  g.Sound.tick();
  g.Sound.rotor(true, false);
  g.Sound.motor(true);
  g.Sound.rumble(true, 0.5);
  g.Sound.stopAll();
  g.updateSoundLoops();

  assert.equal(g.Sound.voices(), 0, 'nothing can sound without a context');
  assert.equal(g.Sound.loops(), 0, 'and nothing sustained can be left running');
});

test('muting is safe before a context has ever been built', () => {
  const { g } = loadFlat();

  g.setSoundOn(false);
  assert.equal(g.Sound.muted(), true);
  g.setSoundOn(true);
  assert.equal(g.Sound.muted(), false);
});

test('a full shot leaves nothing sounding', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 0;
  g.tanks[0].angle = 45;
  g.tanks[0].power = 60;

  h.fireAndSettle();

  assert.equal(g.Sound.voices(), 0);
  assert.equal(g.Sound.loops(), 0, 'a leaked loop would play on into the next turn');
});

test('a round restarting stops everything sustained', () => {
  const h = loadFlat();
  const { g } = h;

  // A missile mid-burn and a helicopter overhead are the two things that are
  // sounding when a round is restarted out from under them.
  g.currentPlayer = 0;
  g.tanks[0].weapon = 'missile';
  g.fire();
  g.spawnHeli();
  h.advance(400);

  g.resetGame();

  assert.equal(g.Sound.loops(), 0, 'resetGame is the backstop for sustained sound');
  assert.equal(g.Sound.voices(), 0);
});

test('the sound toggle is present and defaults to on', () => {
  const { g } = loadFlat();

  assert.equal(g.SOUND.enabled, true);
  assert.ok(g.SOUND.volume > 0 && g.SOUND.volume <= 1, 'master volume is a 0..1 fraction');
  assert.equal(g.el.soundCheckbox.checked, true);
});

test('the toggle label is translated in both languages', () => {
  const { g } = loadFlat();

  for (const key of ['sfx', 'sfxTitle']) {
    const en = g.txt(key);
    assert.ok(en && en.length, `${key} needs an English string`);
  }
  g.el.langCheckbox.checked = true;
  g.el.langCheckbox.dispatch('change');
  assert.equal(g.lang, 'tr');
  assert.equal(g.txt('sfx'), 'SES', 'and a Turkish one');
});
