// The Jet Strike: picking it calls a jet in from one edge, FIRE drops a stick of
// bombs that leave with the jet's speed and fall under gravity and wind, the
// jet makes one pass and leaves, and a jet that is shot down comes down on
// whatever is below it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadFlat, routeHeli } from './harness.mjs';

/** A jet in level flight passing x heading `dir` at this game's current match time. */
function routeJet(g, { x = 300, y = 150, dir = 1, speed = 180, id = 7, seat = 0, bombed = false } = {}) {
  const w = g.jetSize();
  const fromLeft = dir > 0;
  const start = fromLeft ? -w : g.W + w;
  return {
    id, seat, t0: g.netNow() - Math.abs(x - start) / speed, fromLeft, speed, y,
    bombed, falling: false
  };
}

/** Run frames until the shot on screen has landed; returns the first bomb. */
function dropAndSettle(h) {
  h.g.fire();
  const bomb = h.g.projectiles[0];
  h.advanceUntil(() => h.g.state === 'AIMING' || h.g.state === 'GAMEOVER', { maxMs: 20000 });
  return bomb;
}

// ---------- Calling it in ----------

test('picking the jet calls one in from an edge and spends the round', () => {
  const h = loadFlat();
  const { g } = h;
  g.heliDue = g.netNow() + 1e6;
  const t = g.tanks[0];
  const before = t.ammo.jet;
  assert.equal(before, g.WEAPONS.jet.startAmmo);

  g.pickWeapon('jet');

  assert.ok(g.jet, 'a jet is on its way');
  assert.equal(g.jet.seat, 0, 'carrying this seat’s bombs');
  assert.ok(g.jet.x <= 0 || g.jet.x >= g.W, 'coming in from off one edge');
  assert.equal(t.ammo.jet, before - 1, 'the round is spent as it is called');
  assert.equal(t.weapon, 'jet');
  assert.equal(g.jetArmed(0), true);
});

test('once the jet is inbound the choice is made', () => {
  const h = loadFlat();
  const { g } = h;
  g.pickWeapon('jet');

  g.pickWeapon('big');
  assert.equal(g.tanks[0].weapon, 'jet', 'no switching to a shell with the jet on its way');
  for (const [key, b] of g.weaponButtons) {
    assert.equal(b.disabled, key !== 'jet', `${key} button ${key === 'jet' ? 'stays live' : 'locks'}`);
  }
  assert.equal(g.el.weaponSelect.value, 'jet');
});

test('the jet is shown selected even when it was the last round', () => {
  const h = loadFlat();
  const { g } = h;
  g.tanks[0].ammo.jet = 1;
  g.pickWeapon('jet');

  assert.equal(g.tanks[0].ammo.jet, 0);
  assert.equal(g.tanks[0].weapon, 'jet', 'an empty count does not drop it back to the shell mid-pass');
  assert.equal(g.weaponButtons.get('jet').hidden, false);
});

test('only one jet at a time', () => {
  const h = loadFlat();
  const { g } = h;
  g.jet = g.jetIn(routeJet(g, { seat: 1, bombed: true }));
  const id = g.jet.id;
  g.syncControlsFromTank();

  assert.equal(g.summonJet(), false);
  assert.equal(g.jet.id, id, 'the one already up is left alone');
  assert.equal(g.tanks[0].ammo.jet, g.WEAPONS.jet.startAmmo, 'and nothing is spent');
  assert.equal(g.weaponButtons.get('jet').disabled, true);

  g.heliDue = g.netNow() + 1e6;
  h.advanceUntil(() => !g.jet, { maxMs: 10000 });
  assert.equal(g.weaponButtons.get('jet').disabled, false, 'free again once it has left the sky');
});

test('a CPU seat does not call one in', () => {
  const h = loadFlat();
  const { g } = h;
  g.cpuMode = true;
  g.currentPlayer = 1;
  assert.equal(g.isAi(1), true);
  assert.equal(g.summonJet(), false);
  assert.equal(g.jet, null);
});

// ---------- The pass ----------

test('it is faster than the helicopter, whatever either rolls', () => {
  const h = loadFlat();
  const { g } = h;
  h.fixRandom(0.999);           // the slowest jet
  g.spawnJet(0);
  const slowestJet = g.jet.speed;
  h.fixRandom(0);               // the fastest helicopter
  g.spawnHeli();
  const fastestHeli = g.heli.speed;
  assert.ok(slowestJet > fastestHeli * 1.3, `${slowestJet} against ${fastestHeli}`);
});

test('it makes one pass and does not come back', () => {
  const h = loadFlat();
  const { g } = h;
  g.heliDue = g.netNow() + 1e6;
  g.pickWeapon('jet');
  const fromLeft = g.jet.fromLeft;

  let lastX = g.jet.x, turnedBack = false;
  h.advanceUntil(() => {
    if (!g.jet) return true;
    if ((g.jet.x - lastX) * (fromLeft ? 1 : -1) < 0) turnedBack = true;
    lastX = g.jet.x;
    return false;
  }, { maxMs: 10000 });

  assert.equal(g.jet, null, 'gone off the far edge');
  assert.equal(turnedBack, false, 'it never turned round');
  assert.ok(fromLeft ? lastX > g.W - 20 : lastX < 20, 'and it left by the side it was heading for');
  h.advance(10000);
  assert.equal(g.jet, null, 'and it does not reappear');
});

test('a pass that ends with its bombs aboard leaves the turn with the player', () => {
  const h = loadFlat();
  const { g } = h;
  g.heliDue = g.netNow() + 1e6;
  g.pickWeapon('jet');
  h.advanceUntil(() => !g.jet, { maxMs: 10000 });

  assert.equal(g.state, 'AIMING');
  assert.equal(g.currentPlayer, 0, 'still their turn');
  assert.equal(g.tanks[0].weapon, 'standard', 'back on a weapon the barrel can fire');
  assert.equal(g.tanks[0].ammo.jet, g.WEAPONS.jet.startAmmo - 1, 'the round stays spent');
});

// ---------- The drop ----------

test('FIRE waits until the jet is over the field', () => {
  const h = loadFlat();
  const { g } = h;
  g.pickWeapon('jet');
  assert.equal(g.jetOverField(), false, 'it spawns just off the edge');

  g.fire();
  assert.equal(g.state, 'AIMING', 'nothing drops over the edge of the map');
  assert.equal(g.projectiles.length, 0);
  assert.equal(g.jetArmed(0), true, 'the bombs are still aboard');
});

test('FIRE drops a stick of bombs with the jet’s own speed', () => {
  const h = loadFlat();
  const { g } = h;
  g.jet = g.jetIn(routeJet(g, { x: 300, dir: -1, speed: 170 }));
  g.tanks[0].weapon = 'jet';

  g.fire();

  assert.equal(g.state, 'FIRING');
  assert.equal(g.projectiles.length, g.JET.bombs);
  for (const p of g.projectiles) {
    assert.equal(p.weapon, 'jet');
    assert.equal(p.fromJet, true);
    assert.equal(p.vx, -170, 'thrown forward at the jet’s speed');
    assert.equal(p.vy, 0, 'and not thrown down at all');
  }
  assert.deepEqual(Array.from(g.projectiles, p => p.hold), [0, 6, 12], 'released one after another');
  assert.equal(g.jet.bombed, true);
  assert.equal(g.tanks[0].weapon, 'standard', 'the next turn opens on the shell');
});

test('the bombs fall ahead of the drop, by the jet’s speed and the wind', () => {
  const land = (wind) => {
    const h = loadFlat();
    const { g } = h;
    g.heliDue = g.netNow() + 1e6;
    h.placeTanksAt([60, 940]);
    g.wind = wind;
    g.jet = g.jetIn(routeJet(g, { x: 300, y: 150, dir: 1, speed: 180 }));
    g.tanks[0].weapon = 'jet';
    const releaseX = g.jet.x;
    const bomb = dropAndSettle(h);
    return { releaseX, x: bomb.x, h };
  };

  const calm = land(0);
  // Dropped from 250 above flat ground: it falls for sqrt(2 * 250 / GRAVITY).
  const fall = Math.sqrt(2 * (400 - 150) / calm.h.g.GRAVITY);
  const ahead = calm.x - calm.releaseX;
  assert.ok(Math.abs(ahead - 180 * fall) < 12,
    `lands ${ahead.toFixed(1)} ahead of the drop, expected about ${(180 * fall).toFixed(1)}`);

  const tail = land(calm.h.g.WIND_MAX);
  const drift = tail.x - calm.x;
  const expected = 0.5 * calm.h.g.WIND_MAX * fall * fall;
  assert.ok(Math.abs(drift - expected) < 10,
    `a tailwind carries it ${drift.toFixed(1)} further, expected about ${expected.toFixed(1)}`);
  const head = land(-calm.h.g.WIND_MAX);
  assert.ok(head.x < calm.x - expected + 10, 'and a headwind holds it back');
});

test('a bomb never collides with the jet it fell from', () => {
  const h = loadFlat();
  const { g } = h;
  g.heliDue = g.netNow() + 1e6;
  g.jet = g.jetIn(routeJet(g, { x: 300, dir: 1 }));
  g.tanks[0].weapon = 'jet';
  g.fire();
  // Every bomb spawns inside the jet's own hit box.
  assert.equal(g.jetHitBy(g.projectiles[0].x, g.projectiles[0].y), true);

  h.advance(300);
  assert.ok(g.jet, 'still flying');
  assert.equal(g.jet.falling, false, 'its own stick did not bring it down');
});

test('a stick on a tank does real damage and hands the turn on', () => {
  const h = loadFlat();
  const { g } = h;
  g.heliDue = g.netNow() + 1e6;
  // Drop so the middle bomb lands on the tank at 600.
  const fall = Math.sqrt(2 * (400 - 150) / g.GRAVITY);
  const gap = g.JET.bombGapSteps * g.SIM_DT * 180;
  h.placeTanksAt([100, 600]);
  g.jet = g.jetIn(routeJet(g, { x: 600 - 180 * fall - gap, y: 150, dir: 1, speed: 180 }));
  g.tanks[0].weapon = 'jet';

  dropAndSettle(h);

  assert.ok(g.tanks[1].hp < 100 - g.WEAPONS.jet.damageMax, `took ${100 - g.tanks[1].hp}`);
  assert.equal(g.currentPlayer, 1);
  assert.equal(g.tanks[0].hp, 100);
});

// ---------- Shot down ----------

test('the jet stays up after its drop, and a shell can bring it down', () => {
  const h = loadFlat();
  const { g } = h;
  g.jet = g.jetIn(routeJet(g, { x: 500, y: 150, bombed: true }));
  const w = g.jetSize();
  assert.equal(g.jetHitBy(500, 150), true, 'dead centre');
  assert.equal(g.jetHitBy(500 + w * 0.5, 150), true, 'along the fuselage');
  assert.equal(g.jetHitBy(500 + w, 150), false, 'past the nose');
  assert.equal(g.jetHitBy(500, 150 + w * 0.5), false, 'below it');

  const p = { x: 500, y: 160, vx: 0, vy: -300, weapon: 'standard', firedBy: 1, trail: [] };
  g.projectiles = [p];
  g.state = 'FIRING';
  g.stepProjectile(p, 1 / 60);

  assert.equal(p.dead, true, 'the shell bursts on the airframe');
  assert.equal(g.jet.falling, true);
  assert.equal(g.jet.vx, 180, 'the wreck keeps flying forward');
  assert.equal(g.jetHitBy(500, 150), false, 'and cannot be hit again');
});

/** Shoot the jet down at x=300 heading right, and fly the wreck until it lands. */
function crashJet(h) {
  const { g } = h;
  g.state = 'FIRING';   // mid-shot, so the crash does not try to resolve the turn
  g.jet = g.jetIn(routeJet(g, { x: 300, y: 150, dir: 1, speed: 180, bombed: true }));
  g.jetShotDown();
  let lastX = g.jet.x;
  for (let i = 0; i < 600 && g.jet; i++) { lastX = g.jet.x; g.moveJet(g.SIM_DT); }
  assert.equal(g.jet, null, 'it came down');
  return lastX;
}

test('a jet shot down carries forward and crushes the tank it lands on', () => {
  const probe = loadFlat();
  probe.placeTanksAt([60, 940]);
  const landX = crashJet(probe);
  assert.ok(landX > 300 + 60, `the wreck carried on to ${landX.toFixed(1)} before coming down`);

  const h = loadFlat();
  h.placeTanksAt([60, Math.round(landX)]);
  crashJet(h);
  assert.equal(h.g.tanks[1].alive, false, 'the tank it came down on is finished');
  assert.equal(h.g.tanks[0].alive, true, 'one far away is not');
});

test('a wreck holds the turn until it lands', () => {
  const h = loadFlat();
  const { g } = h;
  g.heliDue = g.netNow() + 1e6;
  h.placeTanksAt([100, 900]);
  g.currentPlayer = 1;
  // Straight up into a jet passing overhead: at power 80 the shell climbs the
  // 216 to its altitude in about 0.53s, and the jet covers 80 in that time.
  g.jet = g.jetIn(routeJet(g, { x: 820, y: 150, dir: 1, speed: 150, seat: 0, bombed: true }));
  g.tanks[1].angle = 90;
  g.tanks[1].power = 80;
  g.fire();

  let sawWreck = false;
  h.advanceUntil(() => {
    if (g.jet && g.jet.falling) {
      sawWreck = true;
      assert.notEqual(g.state, 'AIMING', 'no turn while it is still coming down');
    }
    return g.state === 'AIMING' || g.state === 'GAMEOVER';
  }, { maxMs: 20000 });
  assert.ok(sawWreck, 'the shell brought it down');
  assert.equal(g.jet, null, 'and it had landed before the turn moved on');
});

// ---------- In a match ----------

function fakeSocket() {
  const listeners = {};
  const sock = {
    readyState: 1, sent: [],
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    send(text) { sock.sent.push(JSON.parse(text)); },
    close() { sock.readyState = 3; (listeners.close || []).forEach(fn => fn()); },
    emit(t, ev) { (listeners[t] || []).forEach(fn => fn(ev)); },
    deliver(obj) { sock.emit('message', { data: JSON.stringify(obj) }); },
    payloads(kind) {
      return sock.sent.filter(m => m.t === 'msg' && (!kind || m.d.k === kind)).map(m => m.d);
    }
  };
  return sock;
}
const connect = (h, room) => {
  const s = fakeSocket();
  h.g.setSocketFactory(() => s);
  h.g.netConnect(room);
  s.emit('open');
  return s;
};
function liveMatch(opts = {}) {
  const host = loadFlat(opts), guest = loadFlat(opts);
  const hs = connect(host), gs = connect(guest, 'ABCD');
  hs.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  gs.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  hs.deliver({ t: 'peer', id: 2, name: '' });
  hs.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: 'tok2' } });
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  for (const c of [host, guest]) c.g.heliDue = c.g.netNow() + 1e6;
  return { host, guest, hs, gs };
}

test('calling a jet in is announced, and the other screen sees the same one', () => {
  const { host, guest, hs, gs } = liveMatch();
  assert.equal(host.g.currentPlayer, 0);
  host.g.pickWeapon('jet');

  const [msg] = hs.payloads('jet');
  assert.ok(msg, 'a jet message went out');
  gs.deliver({ t: 'msg', from: 1, d: msg });

  const a = host.g.jet, b = guest.g.jet;
  assert.ok(b, 'the guest has it');
  for (const f of ['id', 'seat', 't0', 'fromLeft', 'speed', 'y', 'x', 'dir']) {
    assert.equal(b[f], a[f], `${f} matches`);
  }
  assert.equal(guest.g.tanks[0].ammo.jet, host.g.tanks[0].ammo.jet, 'the round is spent there too');

  host.advance(2000);
  guest.advance(2000);
  assert.ok(Math.abs(host.g.jet.x - guest.g.jet.x) < 1e-6, 'and it flies the same route, unannounced');
});

test('nobody can call a jet in on somebody else’s turn', () => {
  const { guest, gs } = liveMatch();
  assert.equal(guest.g.currentPlayer, 0, 'the host’s turn; the guest is seat 1');
  guest.g.pickWeapon('jet');
  assert.equal(guest.g.summonJet(), false);
  assert.equal(guest.g.jet, null);
  assert.deepEqual(gs.payloads('jet'), []);
});

test('a drop is resolved once and lands the same on both screens', () => {
  const { host, guest, hs, gs } = liveMatch();
  for (const c of [host, guest]) { c.flatTerrain(400); c.placeTanksAt([150, 700]); c.g.wind = 30; }
  host.g.pickWeapon('jet');
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('jet')[0] });

  // Wait for it to come over the field, then drop.
  for (let i = 0; i < 400 && !host.g.jetOverField(); i++) { host.advance(16); guest.advance(16); }
  host.advance(500);
  guest.advance(500);
  host.g.fire();
  const [turn] = hs.payloads('turn');
  assert.ok(turn, 'the drop went out as a turn');
  assert.equal(turn.weapon, 'jet');
  assert.ok(turn.jet && turn.jet.bombed === false, 'carrying the jet it was dropped from');
  assert.ok(turn.result.jet && turn.result.jet.bombed === true, 'and leaving it up, empty');
  gs.deliver({ t: 'msg', from: 1, d: turn });

  host.advanceUntil(() => host.g.state === 'AIMING' && !host.g.activeShot, { maxMs: 20000 });
  guest.advanceUntil(() => guest.g.state === 'AIMING' && !guest.g.activeShot, { maxMs: 20000 });

  assert.deepEqual(Array.from(guest.g.terrain), Array.from(host.g.terrain), 'the same craters');
  assert.deepEqual(Array.from(guest.g.tanks, t => t.hp), Array.from(host.g.tanks, t => t.hp), 'the same damage');
  assert.equal(guest.g.currentPlayer, 1);
  assert.equal(host.g.currentPlayer, 1);
});

test('the jet travels in a snapshot, and one that has left is not brought back', () => {
  const { host, guest } = liveMatch();
  host.g.jet = host.g.jetIn(routeJet(host.g, { x: 420, dir: -1, bombed: true, seat: 0 }));
  guest.g.netApplyState(JSON.parse(JSON.stringify(host.g.netSnapshot())));
  for (const f of ['id', 'seat', 't0', 'fromLeft', 'speed', 'y', 'x', 'dir', 'bombed']) {
    assert.equal(guest.g.jet[f], host.g.jet[f], `${f} survived the trip`);
  }

  // A route that is already over arrives as nothing.
  const gone = host.g.netSnapshot();
  gone.jet = { ...gone.jet, t0: host.g.netNow() - 60 };
  guest.g.netApplyState(JSON.parse(JSON.stringify(gone)), { force: true });
  assert.equal(guest.g.jet, null);
});

test('a round restart clears the sky', () => {
  const h = load();
  h.g.cpuMode = false;
  h.g.resetGame();
  h.g.jet = h.g.jetIn(routeJet(h.g, { x: 500 }));
  h.g.resetGame();
  assert.equal(h.g.jet, null);
});

// ---------- The jet and the helicopter ----------

test('a jet’s bomb can bring the helicopter down', () => {
  const h = loadFlat();
  const { g } = h;
  g.heliDue = g.netNow() + 1e6;
  h.placeTanksAt([60, 940]);
  // Released at x=300 from y=100 at 180 u/s, the first bomb passes y=200 about
  // 138 further on: a helicopter all but hovering there is in its way.
  g.jet = g.jetIn(routeJet(g, { x: 300, y: 100, dir: 1, speed: 180 }));
  g.heli = g.heliIn(routeHeli(g, { x: 438, y: 200, dir: -1, speed: 1 }));
  assert.equal(g.jetMeetsHeliAt(), null, 'a hundred apart in height: they do not collide');
  g.tanks[0].weapon = 'jet';

  g.fire();
  let downed = false;
  h.advanceUntil(() => {
    if (g.heli && g.heli.falling) downed = true;
    return g.state === 'AIMING' || g.state === 'GAMEOVER';
  }, { maxMs: 20000 });

  assert.ok(downed, 'the bomb burst on the airframe');
  assert.equal(g.heli, null, 'and the wreck came down inside the shot');
  assert.ok(g.jet && !g.jet.falling, 'the jet that dropped it flies on');
});

/** A jet and a helicopter at the same height, heading into each other. */
function collisionCourse(g) {
  g.heliDue = g.netNow() + 1e6;
  g.jet = g.jetIn(routeJet(g, { x: 100, y: 150, dir: 1, speed: 180, bombed: true }));
  g.heli = g.heliIn(routeHeli(g, { x: 500, y: 150, dir: -1, speed: 80 }));
}

test('a jet that flies into the helicopter brings both down', () => {
  const h = loadFlat();
  const { g } = h;
  h.placeTanksAt([60, 940]);
  collisionCourse(g);
  const T = g.jetMeetsHeliAt();
  assert.ok(T !== null && T > g.netNow(), 'they are going to meet');

  h.advanceUntil(() => g.jet && g.jet.falling, { maxMs: 5000 });
  assert.ok(g.heli && g.heli.falling, 'the helicopter is coming down too');
  assert.equal(g.jet.t >= T, true);
  assert.ok(Math.abs(g.jet.y - 150) < 40 && Math.abs(g.heli.y - 150) < 40, 'from where they met');
  assert.ok(g.explosions.length > 0, 'with a bang');

  h.advanceUntil(() => !g.jet && !g.heli, { maxMs: 10000 });
  assert.equal(g.jet, null);
  assert.equal(g.heli, null, 'and both land');
});

test('they meet at the same moment on every screen, with nothing sent', () => {
  const { host, guest, hs } = liveMatch();
  for (const c of [host, guest]) collisionCourse(c.g);
  host.advanceUntil(() => host.g.jet && host.g.jet.falling, { maxMs: 5000 });
  guest.advanceUntil(() => guest.g.jet && guest.g.jet.falling, { maxMs: 5000 });

  assert.equal(guest.g.jetMeetsHeliAt(), null, 'nothing left to meet');
  assert.ok(Math.abs(host.g.jet.x - guest.g.jet.x) < 5, 'the jet wreck starts in the same place');
  assert.ok(Math.abs(host.g.heli.x - guest.g.heli.x) < 5, 'and so does the helicopter’s');
  assert.deepEqual(hs.payloads('jet'), [], 'without a jet message');
});

test('the wreckage of a collision destroys a tank it lands on', () => {
  // Where the two wrecks come down, found by letting it happen once.
  const probe = loadFlat();
  probe.placeTanksAt([30, 970]);
  collisionCourse(probe.g);
  let jetX = null, heliX = null;
  probe.advanceUntil(() => {
    if (probe.g.jet) jetX = probe.g.jet.x;
    if (probe.g.heli) heliX = probe.g.heli.x;
    return !probe.g.jet && !probe.g.heli;
  }, { maxMs: 10000 });
  assert.ok(jetX > 150 && jetX < 850 && heliX > 150 && heliX < 850, 'both land on the field');

  for (const [who, x] of [['jet', jetX], ['helicopter', heliX]]) {
    const h = loadFlat();
    h.placeTanksAt([Math.abs(x - 30) > 300 ? 30 : 970, Math.round(x)]);
    collisionCourse(h.g);
    h.advanceUntil(() => !h.g.jet && !h.g.heli, { maxMs: 10000 });
    assert.equal(h.g.tanks[1].alive, false, `the ${who} wreck finishes the tank under it`);
    assert.equal(h.g.tanks[0].alive, true, 'one far away is untouched');
  }
});

test('a collision during a shot holds the turn and lands the same on both screens', () => {
  const { host, guest, hs, gs } = liveMatch();
  for (const c of [host, guest]) {
    c.flatTerrain(400);
    c.placeTanksAt([150, 900]);
    collisionCourse(c.g);
  }
  // A short lob that lands well before the two wrecks do.
  host.g.tanks[0].angle = 60;
  host.g.tanks[0].power = 30;
  host.g.fire();
  const [turn] = hs.payloads('turn');
  assert.ok(turn.result.jet === null && turn.result.heli === null, 'the result has both down already');
  gs.deliver({ t: 'msg', from: 1, d: turn });

  let heldForWreck = false;
  host.advanceUntil(() => {
    if (host.g.jet && host.g.jet.falling && host.g.state === 'EXPLODING') heldForWreck = true;
    return host.g.state === 'AIMING' && !host.g.activeShot;
  }, { maxMs: 20000 });
  guest.advanceUntil(() => guest.g.state === 'AIMING' && !guest.g.activeShot, { maxMs: 20000 });

  assert.ok(heldForWreck, 'the turn waited for the wreckage');
  assert.deepEqual(Array.from(guest.g.terrain), Array.from(host.g.terrain), 'the same craters');
  assert.deepEqual(Array.from(guest.g.tanks, t => t.hp), Array.from(host.g.tanks, t => t.hp));
  assert.equal(host.g.currentPlayer, 1);
  assert.equal(guest.g.currentPlayer, 1);
});
