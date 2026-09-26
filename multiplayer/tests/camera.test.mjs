// The camera. A fixed-shape world has to be drawn small on a phone, so the view
// can be zoomed and panned — but it is only a way of looking, and the thing
// that matters most here is that it cannot reach the simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadFlat } from './harness.mjs';

test('the camera starts fitted to the whole world', () => {
  const { g } = load();
  assert.equal(g.camZoom, g.CAM_MIN);
  assert.equal(g.camX, 0);
  assert.equal(g.camY, 0);
  assert.equal(g.camViewW(), g.W, 'the whole width is in view');
  assert.equal(g.camViewH(), g.H);
});

test('zooming shows proportionally less of the world', () => {
  const { g } = load();
  g.camZoomTo(2);
  assert.equal(g.camViewW(), g.W / 2);
  assert.equal(g.camViewH(), g.H / 2);
});

test('zoom is clamped at both ends', () => {
  const { g } = load();
  g.camZoomTo(500);
  assert.equal(g.camZoom, g.CAM_MAX, 'cannot zoom past the limit');
  g.camZoomTo(0.01);
  assert.equal(g.camZoom, g.CAM_MIN, 'nor further out than the whole world');
});

test('zooming pins the point under the cursor', () => {
  const { g } = load();
  // The world point in the middle of the canvas before and after must match.
  const at = (fx, fy) => ({ x: g.camX + fx * g.camViewW(), y: g.camY + fy * g.camViewH() });
  g.camZoomTo(1.5, 0.5, 0.5);
  const before = at(0.5, 0.5);
  g.camZoomTo(3, 0.5, 0.5);
  const after = at(0.5, 0.5);
  assert.ok(Math.abs(before.x - after.x) < 1e-6, `${before.x} vs ${after.x}`);
  assert.ok(Math.abs(before.y - after.y) < 1e-6);
});

test('the view cannot be panned off the edge of the world', () => {
  const { g } = load();
  g.camZoomTo(2);
  g.camPanByPixels(100000, 100000);   // drag hard up-left
  assert.equal(g.camX, 0, 'stops at the left edge');
  assert.equal(g.camY, 0, 'stops at the top edge');

  g.camPanByPixels(-100000, -100000); // and hard the other way
  assert.equal(g.camX, g.W - g.camViewW(), 'stops at the right edge');
  assert.equal(g.camY, g.H - g.camViewH(), 'stops at the bottom edge');
});

test('fitting returns the whole battlefield', () => {
  const { g } = load();
  g.camZoomTo(4);
  g.camPanByPixels(-200, -200);
  g.camFit();
  assert.equal(g.camZoom, g.CAM_MIN);
  assert.equal(g.camX, 0);
  assert.equal(g.camY, 0);
});

test('a pointer maps to the world under it, wherever the camera is', () => {
  const h = load({ width: 1000, height: 620 });
  const { g } = h;
  const canvas = h.el('game');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: g.viewW, height: g.viewH });

  // Fitted: the middle of the canvas is the middle of the world.
  let p = g.eventToWorld({ clientX: g.viewW / 2, clientY: g.viewH / 2 });
  assert.ok(Math.abs(p.x - g.W / 2) < 1e-6, `${p.x}`);

  // Zoomed into the top-left quarter: the middle of the canvas is a quarter in.
  g.camZoomTo(2, 0, 0);
  p = g.eventToWorld({ clientX: g.viewW / 2, clientY: g.viewH / 2 });
  assert.ok(Math.abs(p.x - g.W / 4) < 1e-6, `${p.x} should be a quarter across`);
  assert.ok(Math.abs(p.y - g.H / 4) < 1e-6);
});

test('the camera never touches the simulation', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  g.wind = 0;

  const before = {
    terrain: Array.from(g.terrain),
    tanks: Array.from(g.tanks, t => [t.x, t.hp, t.angle, t.power]),
    wind: g.wind, W: g.W, H: g.H, physScale: g.physScale
  };

  g.camZoomTo(3.5, 0.2, 0.8);
  g.camPanByPixels(-120, 60);
  g.camCenterOn(700, 300);

  assert.deepEqual(Array.from(g.terrain), before.terrain, 'terrain untouched');
  assert.deepEqual(Array.from(g.tanks, t => [t.x, t.hp, t.angle, t.power]), before.tanks);
  assert.equal(g.wind, before.wind);
  assert.equal(g.W, before.W, 'the world keeps its size');
  assert.equal(g.H, before.H);
  assert.equal(g.physScale, before.physScale, 'and its physics');
});

test('two players zoomed differently still land a shot in the same place', () => {
  const shotLandsAt = (zoom) => {
    const h = loadFlat({ seed: 99 });
    const { g } = h;
    h.flatTerrain(400);
    h.placeTanksAt([200, 700]);
    g.wind = 0;
    g.camZoomTo(zoom);
    g.currentPlayer = 0;
    g.tanks[0].angle = 45;
    g.tanks[0].power = 65;
    g.state = 'AIMING';
    h.fireAndSettle();
    let lowest = 0;
    for (let x = 1; x < g.W; x++) if (g.terrain[x] > g.terrain[lowest]) lowest = x;
    return lowest;
  };
  assert.equal(shotLandsAt(1), shotLandsAt(4), 'zoom is a view, not a handicap');
});

test('the shell stays in view while it flies, once zoomed in', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([120, 880]);
  g.currentPlayer = 0;
  g.tanks[0].angle = 45;
  g.tanks[0].power = 80;
  g.state = 'AIMING';

  g.camZoomTo(3);
  h.advance(500); // the view settles on whoever is aiming, as it does in play

  g.fire();
  let sawItMove = false, lastShellX = null;
  for (let i = 0; i < 40 && g.projectiles.length; i++) {
    h.advance(50);
    const p = g.projectiles[0];
    if (!p) break;
    assert.ok(p.x >= g.camX - 1 && p.x <= g.camX + g.camViewW() + 1,
      `shell at ${p.x.toFixed(0)} left the view ${g.camX.toFixed(0)}..${(g.camX + g.camViewW()).toFixed(0)}`);
    if (lastShellX !== null && p.x > lastShellX) sawItMove = true;
    lastShellX = p.x;
    assert.ok(g.camX >= -1e-6 && g.camX <= g.W - g.camViewW() + 1e-6, 'and the view stays inside the world');
  }
  assert.ok(sawItMove, 'the shell actually travelled');
});

test('a deliberate pan is not yanked away, and is released on the next turn', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([120, 880]);
  g.camZoomTo(3);
  g.currentPlayer = 0;
  g.state = 'AIMING';

  g.camPanned = true;
  g.camCenterOn(880, 400);   // look at the far tank
  const looking = g.camX;
  g.camFollow(0.1);
  assert.equal(g.camX, looking, 'the view stays where it was put');

  g.camPanned = false;
  g.camFollow(1);
  assert.ok(g.camX < looking, 'and settles back on the active tank once released');
});

test('the view controls only offer what is actually possible', () => {
  const h = load();
  const { g } = h;

  g.camFit();
  // Nothing to zoom out of and nothing to fit: those two are not shown at all.
  assert.equal(h.el('zoom-out').hidden, true);
  assert.equal(h.el('zoom-fit').hidden, true);
  assert.equal(h.el('zoom-in').hidden, false);
  assert.equal(h.el('zoom-in').disabled, false);

  g.camZoomTo(2);
  assert.equal(h.el('zoom-out').hidden, false, 'they come back once zoomed');
  assert.equal(h.el('zoom-fit').hidden, false);

  g.camZoomTo(g.CAM_MAX);
  // "+" stays put, disabled: hiding it would slide "−" under a finger that is
  // already tapping "+", so the next tap would undo the zoom.
  assert.equal(h.el('zoom-in').hidden, false, 'still shown at the limit');
  assert.equal(h.el('zoom-in').disabled, true, 'but does nothing');
  assert.equal(h.el('zoom-out').disabled, false);
});

test('zooming reaches the screen on a wide layout too', () => {
  // Regression: worldTransform() was applied by resize() and by the on-canvas
  // wind gauge only. On a screen wide enough for the HUD wind pill that gauge
  // is not drawn, so the camera moved and the picture never did.
  const h = load({ width: 1440, height: 900 });
  const { g } = h;

  // Make the HUD pill visible, the way a wide layout does.
  h.el('wind-hud').offsetParent = {};
  g.resize();

  const scaleOf = (t) => t[0];
  const zoomedScale = () => {
    h.clearTransforms();
    h.advance(32); // a frame or two
    // The widest scale applied is the world transform; screen space is DPR.
    return Math.max(...h.transforms().map(scaleOf));
  };

  const fitted = zoomedScale();
  g.camZoomTo(3);
  const zoomed = zoomedScale();

  assert.ok(h.transforms().length > 0, 'the frame actually drew');
  assert.ok(Math.abs(zoomed - fitted * 3) < 1e-6,
    `world transform should scale with the camera: ${fitted} -> ${zoomed}`);
});

test('the world transform carries the camera offset', () => {
  const h = load({ width: 1000, height: 620 });
  const { g } = h;
  g.camZoomTo(2);
  g.camPanned = true;      // hold the camera still: following would move it mid-frame
  g.camCenterOn(750, 400);
  h.clearTransforms();
  h.advance(32);

  // setTransform(k, 0, 0, k, -camX*k, -camY*k) — the world transform is the
  // one with the largest scale; screen space is just DPR.
  const world = h.transforms().reduce((best, t) => (t[0] > best[0] ? t : best));
  const k = world[0];
  assert.ok(Math.abs(world[4] - (-g.camX * k)) < 1e-6, 'x offset follows the camera');
  assert.ok(Math.abs(world[5] - (-g.camY * k)) < 1e-6, 'y offset follows the camera');
});

test('the zoom buttons keep following the action; a drag or pinch takes over', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([160, 840]);
  g.currentPlayer = 0;
  g.state = 'AIMING';

  h.el('zoom-in').dispatch('click');
  h.el('zoom-in').dispatch('click');
  assert.equal(g.camPanned, false, 'pressing + only says "closer", not "look here"');
  h.advance(1200);
  const tankX = g.tanks[0].x;
  // Zooming about the canvas centre alone would leave the view at 278..722 of
  // a 1000-wide world, with the tank at 160 outside it. Following is what puts
  // it back on screen; the tank sits near the left edge, so the view is
  // clamped there rather than centred on it.
  assert.ok(tankX >= g.camX && tankX <= g.camX + g.camViewW(),
    `the active tank is in view: ${tankX} within ${g.camX.toFixed(0)}..${(g.camX + g.camViewW()).toFixed(0)}`);
  assert.ok(g.camX < 278, 'and the view moved toward it rather than sitting in the middle');

  // A pinch or drag, by contrast, is a deliberate choice of where to look.
  g.camPanByPixels(-50, 0);
  g.camPanned = true;
  const held = g.camX;
  g.camFollow(0.5);
  assert.equal(g.camX, held, 'and following leaves it alone');
});

test('the view holds on the impact instead of swinging back to the shooter', () => {
  const h = loadFlat();
  const { g } = h;
  h.flatTerrain(400);
  h.placeTanksAt([160, 840]);
  g.wind = 0;
  g.currentPlayer = 0;
  g.tanks[0].angle = 45;
  g.tanks[0].power = 70;
  g.state = 'AIMING';
  g.camZoomTo(3);
  h.advance(600); // settle on the shooter

  g.fire();
  h.advanceUntil(() => g.state === 'EXPLODING' || g.state === 'AIMING');
  assert.equal(g.state, 'EXPLODING', 'the shell landed');

  const atImpact = g.camX;
  const blast = g.explosions[g.explosions.length - 1];
  assert.ok(blast.x > g.camX && blast.x < g.camX + g.camViewW(),
    `the impact is in view: blast at ${blast.x.toFixed(0)}, view ${g.camX.toFixed(0)}..${(g.camX + g.camViewW()).toFixed(0)}`);

  // Through the whole explosion the view must not drift back toward the seat
  // that fired -- it is still currentPlayer until the turn advances.
  for (let i = 0; i < 10 && g.state === 'EXPLODING'; i++) {
    h.advance(50);
    assert.ok(Math.abs(g.camX - atImpact) < 1e-6,
      `the view moved during the explosion: ${atImpact.toFixed(0)} -> ${g.camX.toFixed(0)}`);
  }

  // Once the turn changes it goes to the new player, and only then.
  h.advanceUntil(() => g.state === 'AIMING');
  assert.equal(g.currentPlayer, 1);
  h.advance(1500);
  assert.ok(comfortablyInView(g, g.tanks[1].x),
    `and brings the next player into view: ${g.tanks[1].x} in ${g.camX.toFixed(0)}..${(g.camX + g.camViewW()).toFixed(0)}`);
});

/** Inside the view by at least the follow margin (a pixel of easing aside). */
function comfortablyInView(g, x) {
  const m = g.camViewW() * g.CAM_MARGIN;
  return x >= g.camX + m - 1 && x <= g.camX + g.camViewW() - m + 1;
}

// ---------- your own view back on your turn ----------

/** Two humans on one screen, flat and calm, tanks well apart. */
function hotSeat() {
  const h = loadFlat();
  h.placeTanksAt([200, 700]);
  h.g.wind = 0;
  h.g.currentPlayer = 0;
  h.g.state = 'AIMING';
  h.g.tanks.forEach(t => { t.angle = 90; t.power = 30; });   // straight up: nobody is hit
  return h;
}
const near = (a, b, eps = 0.6) => Math.abs(a - b) < eps;

test('your framed view comes back when your turn does', () => {
  const h = hotSeat();
  const { g } = h;
  g.camZoomTo(3);
  g.camCenterOn(450, 380);
  g.camPanned = true;            // framed by hand
  const mine = { zoom: g.camZoom, x: g.camX, y: g.camY };

  h.fireAndSettle();
  assert.equal(g.currentPlayer, 1);
  assert.ok(g.seatViews.has(0), 'saved when you fired');
  h.advance(1500);               // the camera goes off after the other player
  assert.ok(!near(g.camX, mine.x), 'and the view moved on');

  h.fireAndSettle();             // their shot, and back to you
  assert.equal(g.currentPlayer, 0);
  h.advance(1500);
  assert.equal(g.camZoom, mine.zoom);
  assert.ok(near(g.camX, mine.x) && near(g.camY, mine.y), `back to ${mine.x},${mine.y}, got ${g.camX},${g.camY}`);
  assert.equal(g.camPanned, true, 'still yours: following does not pull it away');
});

test('each player sharing the screen gets their own view back', () => {
  const h = hotSeat();
  const { g } = h;
  g.camZoomTo(3); g.camCenterOn(200, 380); g.camPanned = true;
  const first = { x: g.camX, y: g.camY };
  h.fireAndSettle();
  g.camZoomTo(2); g.camCenterOn(700, 380); g.camPanned = true;
  const second = { zoom: g.camZoom, x: g.camX, y: g.camY };
  h.fireAndSettle();
  h.advance(1500);
  assert.equal(g.camZoom, 3);
  assert.ok(near(g.camX, first.x), 'player 1 is back on player 1\'s view');
  h.fireAndSettle();
  h.advance(1500);
  assert.equal(g.camZoom, second.zoom);
  assert.ok(near(g.camX, second.x), 'and player 2 on theirs');
});

test('not framed by hand: your zoom comes back, with your tank in view', () => {
  const h = hotSeat();
  const { g } = h;
  g.camZoomTo(3);                // zoomed with the buttons: the camera follows you
  h.fireAndSettle();
  g.camZoomTo(1);                // the other player zooms all the way out
  h.fireAndSettle();
  h.advance(1500);
  assert.equal(g.camZoom, 3, 'your zoom');
  assert.ok(comfortablyInView(g, g.tanks[0].x), 'your tank is in view');
  assert.equal(g.camPanned, false);
});

test('touching the camera while it eases back leaves it where you put it', () => {
  const h = hotSeat();
  const { g } = h;
  g.camZoomTo(3); g.camCenterOn(450, 380); g.camPanned = true;
  h.fireAndSettle();
  g.camZoomTo(1);
  h.fireAndSettle();
  assert.ok(g.camReturn, 'easing back');
  g.camZoomTo(2);                // the player zooms themselves
  assert.equal(g.camReturn, null);
  h.advance(1500);
  assert.equal(g.camZoom, 2);
});

test('against the CPU, your view is back after its turn; a new round forgets it', () => {
  const h = load();
  const { g } = h;
  g.el.modeSelect.value = 'cpu';
  g.el.modeSelect.dispatch('change');
  g.resetGame();
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  g.wind = 0;
  g.tanks[0].angle = 90; g.tanks[0].power = 30;
  g.camZoomTo(3); g.camCenterOn(450, 380); g.camPanned = true;
  const mine = { x: g.camX, y: g.camY };
  h.fireAndSettle();
  assert.equal(g.seatViews.has(1), false, 'the CPU keeps no view');
  assert.ok(h.advanceUntil(() => g.currentPlayer === 0 && g.state === 'AIMING'), 'the CPU has played');
  h.advance(1500);
  assert.equal(g.camZoom, 3);
  assert.ok(near(g.camX, mine.x));

  g.resetGame();
  assert.equal(g.seatViews.size, 0, 'a new board: the old framing does not fit it');
});

// ---------- a new board, following only when needed, and the sky ----------

test('a new round starts with the whole battlefield in view', () => {
  const h = hotSeat();
  const { g } = h;
  g.camZoomTo(3); g.camCenterOn(600, 380); g.camPanned = true;
  g.resetGame();
  assert.equal(g.camZoom, g.CAM_MIN);
  assert.equal(g.camX, 0);
  assert.equal(g.camY, 0);
  assert.equal(g.camPanned, false);
  h.advance(500);
  assert.equal(g.camZoom, g.CAM_MIN, 'and stays there');
});

test('a shot whose whole flight is in view does not move the camera', () => {
  const h = hotSeat();
  const { g } = h;
  h.placeTanksAt([450, 580]);    // both tanks in view, so the turn passing does not move it either
  g.camZoomTo(2);
  g.camCenterOn(450, 330);        // the tanks, the arc and the ground all well inside
  h.advance(600);
  const at = { x: g.camX, y: g.camY };
  g.tanks[0].angle = 80; g.tanks[0].power = 30;   // a short lob, up and down nearby
  g.fire();
  let moved = 0;
  while (g.state !== 'AIMING' && moved === 0) {
    h.advance(16);
    if (Math.abs(g.camX - at.x) > 1e-6 || Math.abs(g.camY - at.y) > 1e-6) moved++;
  }
  assert.equal(moved, 0, 'not a pixel');
  assert.equal(g.camZoom, 2, 'and the zoom is kept');
});

test('a long shot is followed, and never leaves the screen', () => {
  const h = hotSeat();
  const { g } = h;
  h.placeTanksAt([120, 880]);
  g.camZoomTo(3);
  h.advance(600);
  g.tanks[0].angle = 45; g.tanks[0].power = 70;
  g.fire();
  const start = g.camX;
  while (g.state === 'FIRING') {
    h.advance(16);
    const p = g.projectiles[0];
    if (!p || p.x < 0 || p.x > g.W || p.y < 0) continue;
    assert.ok(p.x >= g.camX && p.x <= g.camX + g.camViewW(), `shell at ${p.x.toFixed(0)} out of ${g.camX.toFixed(0)}..${(g.camX + g.camViewW()).toFixed(0)}`);
  }
  assert.ok(g.camX > start + 100, 'the view went downrange with it');
});

test('a turn passing to a tank already in view does not move the camera', () => {
  const h = hotSeat();
  const { g } = h;
  h.placeTanksAt([420, 540]);
  g.camZoomTo(2);
  g.camCenterOn(480, 380);
  h.advance(300);
  const at = g.camX;
  h.fireAndSettle();   // straight up: nobody is hit
  assert.equal(g.currentPlayer, 1);
  h.advance(1000);
  assert.ok(Math.abs(g.camX - at) < 1e-6, 'both tanks were in view all along');
});

test('a helicopter zooms the view out, and its leaving zooms it back', () => {
  const h = hotSeat();
  const { g } = h;
  g.camZoomTo(3); g.camCenterOn(450, 380); g.camPanned = true;
  const mine = { x: g.camX, y: g.camY };
  g.spawnHeli();
  h.advance(1500);
  assert.equal(g.camZoom, g.CAM_MIN, 'the whole field, to see where it is');

  g.heli = null;       // flown off
  h.advance(1500);
  assert.equal(g.camZoom, 3, 'back to the zoom you had');
  assert.ok(near(g.camX, mine.x) && near(g.camY, mine.y), 'and where you had it');
});

test('a jet does the same', () => {
  const h = hotSeat();
  const { g } = h;
  g.camZoomTo(2.5);
  assert.equal(g.summonJet(), true);
  h.advance(2000);
  assert.equal(g.camZoom, g.CAM_MIN);
  g.jet = null;
  h.advance(1500);
  assert.equal(g.camZoom, 2.5);
});

test('zoom while the aircraft is up and the view is yours: nothing is undone', () => {
  const h = hotSeat();
  const { g } = h;
  g.camZoomTo(3);
  g.spawnHeli();
  h.advance(1500);
  g.camZoomTo(2);      // the player looks closer, on purpose
  assert.equal(g.skyHandsOff, false);
  g.heli = null;
  h.advance(1500);
  assert.equal(g.camZoom, 2, 'left as they put it');
});

test('your turn view waits for the sky to clear', () => {
  const h = hotSeat();
  const { g } = h;
  g.camZoomTo(3); g.camCenterOn(450, 380); g.camPanned = true;
  const mine = { x: g.camX, y: g.camY };
  h.fireAndSettle();               // player 1 fires; player 2's turn
  g.spawnHeli();
  h.advance(1500);
  assert.equal(g.camZoom, g.CAM_MIN);
  h.fireAndSettle();               // player 2 fires; back to player 1
  assert.equal(g.currentPlayer, 0);
  h.advance(1500);
  assert.equal(g.camZoom, g.CAM_MIN, 'still the whole field while it is up');
  g.heli = null;
  h.advance(1500);
  assert.equal(g.camZoom, 3, 'then your own view');
  assert.ok(near(g.camX, mine.x) && near(g.camY, mine.y));
});
