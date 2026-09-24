// The controls and readouts: per-seat weapon state, aim nudging, the HUD
// banner, the language switch and the remembered table setup.
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

  // The slider is a spatial control: its value is the mirror of the angle, so
  // that dragging left aims left.
  assert.equal(Number(g.el.angleSlider.value), 60);
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

  // The option labels are the only place the count is shown now, so they have
  // to carry it — the separate readout under the select was removed as a
  // duplicate of exactly this.
  const opt = k => g.el.weaponSelect.options.find(o => o.value === k);
  assert.match(opt('standard').textContent, /\(∞\)$/, 'unlimited ammo is spelled out');
  assert.match(opt('mirv').textContent, /\(0\)$/, 'and an empty weapon shows zero');
  assert.equal(opt('mirv').disabled, true, 'and cannot be chosen');
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

  assert.equal(Number(g.el.angleSlider.value), 180 - t.angle, 'the slider follows the arrows');
});

test('dragging the angle slider aims the current tank', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;

  h.setAngleSlider(77);

  assert.equal(g.tanks[0].angle, 103, 'the slider position is mirrored into a world angle');
  assert.equal(g.el.angleVal.textContent, '103°', 'and the readout shows the world angle');
});

test('the slider round-trips every angle', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;

  for (const angle of [0, 1, 45, 90, 135, 179, 180]) {
    g.tanks[0].angle = angle;
    g.syncControlsFromTank();
    h.setAngleSlider(g.el.angleSlider.value);
    assert.equal(g.tanks[0].angle, angle, `angle ${angle} did not survive the slider`);
  }
});

test('the slider tells assistive tech the angle, not its own position', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  g.tanks[0].angle = 135;

  g.syncControlsFromTank();

  // The value is mirrored, so on its own it would be announced as "45".
  assert.equal(g.el.angleSlider.attributes['aria-valuetext'], '135°');
  assert.equal(g.el.angleVal.textContent, '135°', 'and it matches what is on screen');
});

test('the banner says whose turn it is, and what the round is doing', () => {
  const h = loadFlat();
  const { g } = h;
  const banner = g.el.turnBanner;

  g.cpuMode = false;
  g.currentPlayer = 0;
  g.state = 'AIMING';
  g.updateHUD();
  // On your own turn the banner names you and stops there: the controls beside
  // it are the instruction, so "AIM & FIRE" only ever cost the rail width.
  assert.match(banner.textContent, /PLAYER 1/i, banner.textContent);

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

  assert.equal(g.el.hpText[0].textContent, '42');
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

test('the table setup is remembered: tanks, opponents and CPU level', () => {
  const h = loadFlat();
  const { g } = h;
  const store = h.ctx.window.localStorage;
  g.el.countSelect.value = '4';
  g.el.countSelect.dispatch('change');
  g.el.modeSelect.value = 'human';
  g.el.modeSelect.dispatch('change');
  g.el.difficultySelect.value = 'brutal';
  g.el.difficultySelect.dispatch('change');

  assert.equal(store.getItem('barrage.count'), '4');
  assert.equal(store.getItem('barrage.mode'), 'human');
  assert.equal(store.getItem('barrage.difficulty'), 'brutal');
});

test('the stored setup is restored, and a value no longer offered keeps the default', () => {
  const h = loadFlat();
  const { g } = h;
  const store = h.ctx.window.localStorage;
  store.setItem('barrage.count', '5');
  store.setItem('barrage.mode', 'human');
  store.setItem('barrage.difficulty', 'hard');
  g.initSetup();
  assert.equal(g.el.countSelect.value, '5');
  assert.equal(g.playerCount, 5);
  assert.equal(g.cpuMode, false);
  assert.equal(g.aiDifficulty, 'hard');
  g.resetGame();
  assert.equal(g.tanks.length, 5, 'the next round is dealt with the restored roster');

  store.setItem('barrage.count', '9');
  store.setItem('barrage.difficulty', 'nightmare');
  g.initSetup();
  assert.equal(g.playerCount, 5, 'an unknown count leaves the select where it was');
  assert.equal(g.aiDifficulty, 'hard');
});

// ---------------------------------------------------------------------------
// Aim direction. The angle is world space (0 = due right, 180 = due left), so
// "aims further left" is "cos(angle) gets smaller" — the barrel tip moves left
// on screen. Asserting on the barrel rather than on the number is the point:
// it is the thing the player sees, and it survives a change of units.
// ---------------------------------------------------------------------------
const barrelX = (angle) => Math.cos(angle * Math.PI / 180);

test('the left arrow button aims left', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  g.tanks[0].angle = 90;

  const [left, right] = g.el.nudgeBtns; // angle-left, angle-right
  left.dispatch('click', { detail: 0 }); // detail 0 is the keyboard path

  assert.ok(barrelX(g.tanks[0].angle) < barrelX(90), 'the barrel swung right instead of left');
});

test('the right arrow button aims right', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  g.tanks[0].angle = 90;

  const right = g.el.nudgeBtns[1];
  right.dispatch('click', { detail: 0 });

  assert.ok(barrelX(g.tanks[0].angle) > barrelX(90));
});

test('the arrow keys aim the way they point', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  g.state = 'AIMING';

  g.tanks[0].angle = 90;
  h.key('ArrowLeft');
  assert.ok(barrelX(g.tanks[0].angle) < barrelX(90), 'ArrowLeft must aim left');

  g.tanks[0].angle = 90;
  h.key('ArrowRight');
  assert.ok(barrelX(g.tanks[0].angle) > barrelX(90), 'ArrowRight must aim right');
});

test('dragging the slider left aims left', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  g.tanks[0].angle = 90;
  g.syncControlsFromTank();
  const middle = Number(g.el.angleSlider.value);

  h.setAngleSlider(middle - 30); // thumb toward the left end
  const leftAim = g.tanks[0].angle;
  h.setAngleSlider(middle + 30); // thumb toward the right end
  const rightAim = g.tanks[0].angle;

  assert.ok(barrelX(leftAim) < barrelX(90), 'thumb left should aim left');
  assert.ok(barrelX(rightAim) > barrelX(90), 'thumb right should aim right');
});

test('aiming works the same for a tank on the right of the map', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([200, 700]);
  g.currentPlayer = 1;
  g.state = 'AIMING';
  g.tanks[1].angle = 135; // the right-hand tank lobs left, past vertical

  h.key('ArrowLeft');

  // This is where the old mapping felt worst: past 90° the control and the
  // barrel disagreed most obviously.
  assert.ok(barrelX(g.tanks[1].angle) < barrelX(135), 'ArrowLeft aimed right for a right-side tank');
});

test('the keys do nothing on a CPU seat or between turns', () => {
  const h = loadFlat();
  const { g } = h;
  g.cpuMode = true;
  g.currentPlayer = 1; // a CPU seat
  g.state = 'AIMING';
  g.tanks[1].angle = 100;
  h.key('ArrowLeft');
  assert.equal(g.tanks[1].angle, 100, 'a player must not aim for the CPU');

  g.cpuMode = false;
  g.state = 'FIRING';
  g.currentPlayer = 0;
  g.tanks[0].angle = 45;
  h.key('ArrowLeft');
  assert.equal(g.tanks[0].angle, 45, 'nor while a shell is in the air');
});

test('the wind is read from the bar or from the canvas, never from both', () => {
  const h = loadFlat();
  const { g } = h;

  // Nothing is laid out in the stub DOM, so the pill reads as off screen —
  // which is the phone-landscape case, where the gauge is painted on the sky.
  assert.equal(g.el.windHud.offsetParent, null);
  g.resize();
  assert.equal(g.hudWindVisible, false, 'no pill, so the canvas draws the gauge');

  // Portrait and the wide bar both put the pill on screen instead. The draw
  // path asks this before painting a gauge, so one readout becomes the other.
  g.el.windHud.offsetParent = g.el.windHud;
  g.resize();
  assert.equal(g.hudWindVisible, true, 'pill on screen, so the sky stays clear');
});

// Pull from (ax, ay) to (x, y) on the canvas with one pointer.
function pull(g, id, ax, ay, x, y) {
  g.canvas.dispatch('pointerdown', { pointerId: id, button: 0, clientX: ax, clientY: ay });
  g.canvas.dispatch('pointermove', { pointerId: id, clientX: x, clientY: y });
}

function release(g, id, x, y) {
  g.canvas.dispatch('pointerup', { pointerId: id, clientX: x, clientY: y });
}

test('pulling back on the field aims opposite the pull and sets power by length', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  const t = g.tanks[0];
  const reach = g.pullReach();
  const DEAD = 14;

  // Pull straight down: aim straight up. Dead zone plus half the reach = 50.
  pull(g, 1, 300, 200, 300, 200 + DEAD + reach / 2);
  assert.equal(t.angle, 90);
  assert.equal(t.power, 50);
  assert.equal(Number(g.el.angleSlider.value), 90, 'the angle slider follows');
  assert.equal(Number(g.el.powerSlider.value), 50, 'the power slider follows');

  // Pull down and to the left: aim up and to the right, capped at full power.
  g.canvas.dispatch('pointermove', { pointerId: 1, clientX: 300 - reach, clientY: 200 + reach });
  assert.equal(t.angle, 45);
  assert.equal(t.power, 100);
  assert.equal(g.el.angleVal.textContent, '45°');
  assert.equal(g.state, 'AIMING', 'nothing fires until the pull is released');

  release(g, 1, 300 - reach, 200 + reach);
  assert.notEqual(g.state, 'AIMING', 'releasing the pull fires');
  assert.equal(g.aimDrag, null);
});

test('the pull is measured on screen, so zoom is not a handicap', () => {
  const powerAt = (zoom) => {
    const h = loadFlat();
    const { g } = h;
    g.currentPlayer = 0;
    g.camZoomTo(zoom);
    pull(g, 1, 300, 200, 300, 200 + 14 + g.pullReach() / 2);
    return g.tanks[0].power;
  };
  assert.equal(powerAt(1), 50);
  assert.equal(powerAt(4), 50, 'the same finger travel is the same shot, zoomed in');
});

test('releasing inside the dead zone cancels and restores the aim', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  const t = g.tanks[0];
  t.angle = 60; t.power = 40;

  pull(g, 1, 300, 200, 250, 300);
  assert.notEqual(t.angle, 60, 'the pull moved the aim');
  g.canvas.dispatch('pointermove', { pointerId: 1, clientX: 305, clientY: 203 });
  assert.deepEqual([t.angle, t.power], [60, 40], 'back in the dead zone shows the old aim');
  release(g, 1, 305, 203);
  assert.equal(g.state, 'AIMING', 'a release in the dead zone does not fire');

  // A cancelled pointer never fires either, however far it was pulled.
  pull(g, 2, 300, 200, 200, 300);
  g.canvas.dispatch('pointercancel', { pointerId: 2 });
  assert.equal(g.state, 'AIMING');
  assert.deepEqual([t.angle, t.power], [60, 40]);
});

test('a finger gets a ring wider than the finger to cancel in', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  const t = g.tanks[0];
  t.angle = 60; t.power = 40;
  const touch = (type, id, x, y) =>
    g.canvas.dispatch(type, { pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y });

  // Pull out, then come back to 30 px from the press - outside a mouse's ring,
  // inside a finger's - and let go: a cancel, not a feeble shot.
  touch('pointerdown', 1, 300, 200);
  touch('pointermove', 1, 300, 300);
  assert.equal(t.angle, 90, 'the pull moved the aim');
  touch('pointermove', 1, 300, 230);
  assert.deepEqual([t.angle, t.power], [60, 40], 'inside the ring shows the old aim');
  g.render(); // draws the cancel cross
  touch('pointerup', 1, 300, 230);
  assert.equal(g.state, 'AIMING', 'a release inside the finger ring does not fire');
  assert.deepEqual([t.angle, t.power], [60, 40]);

  // Power still starts at the ring's edge, so the stroke past it is unchanged.
  touch('pointerdown', 2, 300, 200);
  touch('pointermove', 2, 300, 200 + 40 + g.pullReach() / 2);
  assert.equal(t.power, 50);
  touch('pointercancel', 2, 300, 200);

  // A mouse released at the same 30 px fires, as it always has.
  pull(g, 3, 300, 200, 300, 300);
  g.canvas.dispatch('pointermove', { pointerId: 3, clientX: 300, clientY: 230 });
  g.canvas.dispatch('pointerup', { pointerId: 3, clientX: 300, clientY: 230 });
  assert.notEqual(g.state, 'AIMING', 'a mouse ring is still 14 px');
});

test('crossing the ring ticks, where the device can vibrate', () => {
  const h = loadFlat();
  const { g } = h;
  const ticks = [];
  h.ctx.navigator.vibrate = (ms) => { ticks.push(ms); return true; };
  g.currentPlayer = 0;

  pull(g, 1, 300, 200, 300, 205);
  assert.equal(ticks.length, 0, 'inside the ring: nothing yet');
  g.canvas.dispatch('pointermove', { pointerId: 1, clientX: 300, clientY: 300 });
  g.canvas.dispatch('pointermove', { pointerId: 1, clientX: 300, clientY: 310 });
  assert.equal(ticks.length, 1, 'once on the way out, not on every move');
  g.canvas.dispatch('pointermove', { pointerId: 1, clientX: 300, clientY: 203 });
  assert.equal(ticks.length, 2, 'and once on the way back in');
});

test('pulling does nothing on a CPU turn or mid-flight', () => {
  const h = loadFlat();
  const { g } = h;
  g.cpuMode = true;
  g.currentPlayer = 1;
  const cpu = g.tanks[1];
  const before = [cpu.angle, cpu.power];
  pull(g, 1, 300, 200, 200, 300);
  release(g, 1, 200, 300);
  assert.deepEqual([cpu.angle, cpu.power], before);
  assert.equal(g.aimDrag, null);

  g.cpuMode = false;
  g.currentPlayer = 0;
  g.state = 'FIRING';
  const t = g.tanks[0];
  t.angle = 60; t.power = 40;
  pull(g, 2, 300, 200, 200, 300);
  assert.deepEqual([t.angle, t.power], [60, 40]);
});

test('a seat someone else is playing cannot be aimed by pulling', () => {
  const h = loadFlat();
  const { g } = h;
  g.online.status = 'playing';
  g.online.seat = 0;
  g.currentPlayer = 1;              // the other player's turn
  const t = g.tanks[1];
  t.angle = 60; t.power = 40;

  pull(g, 1, 300, 200, 200, 300);
  release(g, 1, 200, 300);
  assert.deepEqual([t.angle, t.power], [60, 40], 'their tank is no more ours than a CPU\'s');
  assert.equal(g.state, 'AIMING', 'and nothing fires');
});

test('one finger aims on your own turn and drags the view on anyone else\'s', () => {
  const h = loadFlat();
  const { g } = h;
  g.camZoomTo(3);
  g.camCenterOn(g.W / 2, g.H / 2);

  // Your turn: the pull owns the finger, so the drag does not pan. (camFollow
  // still eases onto the seat that is aiming; that is the frame loop's, and it
  // is not ticked here.)
  g.currentPlayer = 0;
  const at = g.camX;
  pull(g, 1, 300, 200, 200, 260);
  assert.equal(g.camX, at, 'the drag aimed instead of dragging the view');
  assert.notEqual(g.aimDrag, null);
  g.canvas.dispatch('pointercancel', { pointerId: 1 });
  g.canvas.dispatch('pointerup', { pointerId: 1 });

  // Someone else's turn: the same drag is a pan again.
  g.online.status = 'playing';
  g.online.seat = 0;
  g.currentPlayer = 1;
  pull(g, 2, 300, 200, 200, 260);
  assert.equal(g.aimDrag, null, 'no pull starts on their seat');
  assert.notEqual(g.camX, at, 'so the finger drags the view instead');
  g.canvas.dispatch('pointerup', { pointerId: 2 });
});

test('a second finger takes the gesture back for the camera', () => {
  const h = loadFlat();
  const { g } = h;
  g.currentPlayer = 0;
  const t = g.tanks[0];
  t.angle = 60; t.power = 40;

  pull(g, 1, 300, 200, 220, 280);
  assert.notEqual(g.aimDrag, null);

  // Pinching to look closer must not leave a loaded slingshot behind.
  g.canvas.dispatch('pointerdown', { pointerId: 2, button: 0, clientX: 400, clientY: 300 });
  assert.equal(g.aimDrag, null, 'the pull is dropped');
  assert.deepEqual([t.angle, t.power], [60, 40], 'and the aim is put back');

  g.canvas.dispatch('pointermove', { pointerId: 2, clientX: 500, clientY: 400 });
  assert.equal(g.state, 'AIMING', 'pinching never fires');
  release(g, 1, 220, 280);
  release(g, 2, 500, 400);
  assert.equal(g.state, 'AIMING', 'nor does letting the pinch go');
});
