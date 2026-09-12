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
  for (let seat = 0; seat < 4; seat++) g.Sound.fire(80, seat, seat / 3); // every reload signature
  g.Sound.explode(26);
  g.Sound.explode(26, 0.1);
  g.Sound.destroyed();
  g.Sound.destroyed(0.9);
  g.Sound.tick();
  g.Sound.rotor(true, false, 0.2);
  g.Sound.motor(true, 0.4);
  g.Sound.rumble(true, 0.5, 0.6);
  g.Sound.whistle(true, { pitch01: 0.8, speed01: 0.5, impactIn: 0.4, x01: 0.8 });
  g.Sound.whistle(true, { pitch01: 0.2, speed01: 1, impactIn: Infinity, x01: 0.2 });
  g.Sound.whistle(true, { pitch01: 0.5, speed01: 0.7, impactIn: 1, x01: 0.5, flight: g.FLIGHT.big });
  g.Sound.stopAll();
  g.updateSoundLoops();

  assert.equal(g.Sound.voices(), 0, 'nothing can sound without a context');
  assert.equal(g.Sound.loops(), 0, 'and nothing sustained can be left running');
  assert.deepEqual(g.Sound.loopNames(), []);
});

test('muting is safe before a context has ever been built', () => {
  const { g } = loadFlat();

  g.setSoundOn(false);
  assert.equal(g.Sound.muted(), true);
  g.setSoundOn(true);
  assert.equal(g.Sound.muted(), false);
});

test('a shell in flight drives the whistle without throwing', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 0;
  g.tanks[0].angle = 50;
  g.tanks[0].power = 70;
  g.fire();

  // Mid-flight: updateSoundLoops reads vy off the live shell every frame, so a
  // shell that has left the barrel must not upset it.
  h.advance(300);
  assert.ok(g.projectiles.length > 0, 'still airborne');
  g.updateSoundLoops();
  assert.equal(g.Sound.loops(), 0, 'silent here, but it must not have thrown');
});

test('the whistle knows how soon a shell will land, and counts it down', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 0;
  g.tanks[0].angle = 50;
  g.tanks[0].power = 70;
  g.fire();

  h.advance(300);
  assert.ok(g.projectiles.length > 0, 'still airborne');
  const first = g.secondsToImpact(g.projectiles[0]);
  assert.ok(Number.isFinite(first) && first > 0, 'an airborne shell has an impact ahead of it');

  h.advance(300);
  assert.ok(g.projectiles.length > 0, 'still airborne');
  const later = g.secondsToImpact(g.projectiles[0]);
  assert.ok(later < first, 'and it counts down');
  assert.ok(Math.abs((first - later) - 0.3) < 0.15, 'roughly in step with the clock');
});

test('every weapon has its own flight sound, and split warheads theirs', () => {
  const { g } = loadFlat();
  const fields = ['pitch', 'spin', 'tumble', 'shriek', 'rush', 'level'];

  for (const key of Object.keys(g.WEAPONS)) {
    assert.ok(g.FLIGHT[key], `${key} needs a FLIGHT profile of its own`);
    const fl = g.flightOf({ weapon: key });
    for (const f of fields) assert.ok(Number.isFinite(fl[f]) && fl[f] > 0, `${key}.${f}`);
  }
  assert.equal(g.flightOf({ weapon: 'nonsense' }), g.FLIGHT.standard, 'an unknown weapon falls back');
  assert.equal(g.flightOf({ weapon: 'mirv', split: true }), g.FLIGHT.warhead,
    'a split warhead sounds like a warhead');
  assert.equal(g.flightOf({ weapon: 'mirv' }), g.FLIGHT.mirv, 'and the bus before it splits does not');
  assert.ok(g.FLIGHT.big.pitch < g.FLIGHT.standard.pitch, 'a heavy bomb whistles lower');
  assert.ok(g.FLIGHT.warhead.pitch > g.FLIGHT.standard.pitch, 'and a warhead higher');
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

test('sound defaults to on', () => {
  const { g } = loadFlat();

  assert.equal(g.SOUND.enabled, true);
  assert.ok(g.SOUND.volume > 0 && g.SOUND.volume <= 1, 'master volume is a 0..1 fraction');
  assert.equal(g.Sound.muted(), false);
});

test('the toggle label is translated in both languages', () => {
  const { g } = loadFlat();

  for (const key of ['sfx', 'sfxTitle', 'sfxVolume']) {
    const en = g.txt(key);
    assert.ok(en && en.length, `${key} needs an English string`);
  }
  g.el.langCheckbox.checked = true;
  g.el.langCheckbox.dispatch('change');
  assert.equal(g.lang, 'tr');
  assert.equal(g.txt('sfx'), 'SES', 'and a Turkish one');
  assert.equal(g.el.sfxSlider.attributes['aria-label'], g.txt('sfxVolume'),
    'the level slider is relabelled too');
});

test('the level slider starts at the default level and maps evenly', () => {
  const { g } = loadFlat();

  assert.equal(g.sfxLevel, g.SOUND.volume);
  assert.equal(g.el.sfxSlider.value, String(g.levelToSlider(g.SOUND.volume)));
  assert.equal(g.sliderToLevel(0), 0);
  assert.equal(g.sliderToLevel(100), 1);
  assert.equal(g.sliderToLevel(50), 0.25, 'squared, so the travel is heard evenly');
  assert.ok(Math.abs(g.sliderToLevel(g.levelToSlider(0.49)) - 0.49) < 1e-9, 'and it round-trips');
});

test('the level slider is the mute: zero is off, anything above is on', () => {
  const { g } = loadFlat();

  g.el.sfxSlider.value = '0';
  g.el.sfxSlider.dispatch('input');
  assert.equal(g.Sound.muted(), true, 'zero mutes');
  assert.equal(g.sfxLevel, 0);

  g.el.sfxSlider.value = '30';
  g.el.sfxSlider.dispatch('input');
  assert.equal(g.Sound.muted(), false, 'and raising it unmutes');
  assert.ok(Math.abs(g.sfxLevel - 0.09) < 1e-9);

  g.el.sfxSlider.dispatch('change'); // the preview tick must not throw without audio
  g.setSfxLevel(7);
  assert.equal(g.sfxLevel, 1, 'the level is clamped');
});

test('screen position maps to a stereo position short of hard left and right', () => {
  const { g } = loadFlat();

  assert.equal(g.panOf(0.5), 0, 'the middle is centred');
  assert.equal(g.panOf(0), -0.75);
  assert.equal(g.panOf(1), 0.75);
  assert.equal(g.panOf(-3), -0.75, 'off the left edge clamps');
  assert.equal(g.panOf(9), 0.75, 'and off the right');
  assert.equal(g.panOf(undefined), 0, 'no position is centred, not NaN');
});
