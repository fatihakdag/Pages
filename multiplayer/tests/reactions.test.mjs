// Reactions: the eight emoji a player can send over their tank, the CPU's own,
// and muting a player.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadFlat } from './harness.mjs';

function fakeSocket() {
  const listeners = {};
  const sock = {
    readyState: 1, sent: [],
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    send(text) { sock.sent.push(JSON.parse(text)); },
    close() { sock.readyState = 3; sock.emit('close'); },
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

/** A live two-seat match: host id 1 in seat 0, guest id 2 in seat 1. */
function liveMatch() {
  const host = load(), guest = load();
  const hs = connect(host), gs = connect(guest, 'ABCD');
  hs.deliver({ t: 'joined', room: 'ABCD', id: 1, host: 1, peers: [] });
  gs.deliver({ t: 'joined', room: 'ABCD', id: 2, host: 1, peers: [{ id: 1, name: '' }] });
  hs.deliver({ t: 'peer', id: 2, name: '' });
  hs.deliver({ t: 'msg', from: 2, d: { k: 'ready', token: guest.g.online.token } });
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start')[0] });
  return { host, guest, hs, gs };
}

/** Hand the guest's last reaction to the host, as the relay would. */
function relayLast(fromSock, toSock, fromId) {
  const d = fromSock.payloads('emote').slice(-1)[0];
  toSock.deliver({ t: 'msg', from: fromId, d });
  return d;
}

function mode(h, value) {
  h.g.el.modeSelect.value = value;
  h.g.el.modeSelect.dispatch('change');
  h.g.resetGame();
}

const shown = (h) => Array.from(h.g.emotes, m => [m.seat, m.e]);

// ---------- phase 1: sending and showing ----------

test('the set is eight fixed emoji, each named in both languages', () => {
  const h = load();
  const chars = Array.from(h.g.EMOTES, e => e.ch);
  assert.deepEqual(chars, ['👏', '😡', '😂', '😱', '😈', '🙏', '💀', '🤝']);
  for (const e of h.g.EMOTES) assert.notEqual(h.g.txt(e.key), e.key, `${e.key} in English`);
  h.g.el.langCheckbox.checked = true;
  h.g.el.langCheckbox.dispatch('change');
  for (const e of h.g.EMOTES) assert.notEqual(h.g.txt(e.key), e.key, `${e.key} in Turkish`);
  assert.equal(h.g.txt('e_gg'), 'İyi oyundu');
});

test('the button is there against the CPU and online, not all human on one screen', () => {
  const h = load();
  mode(h, 'cpu');
  assert.equal(h.g.el3.reactCtl.hidden, false, 'vs CPU');
  mode(h, 'human');
  assert.equal(h.g.el3.reactCtl.hidden, true, 'all human: nobody to react to');
  assert.equal(h.g.sendEmote(0), false);

  const { guest } = liveMatch();
  assert.equal(guest.g.el3.reactCtl.hidden, false, 'online');
});

test('a reaction goes up over your own tank and on your card', () => {
  const h = load();
  mode(h, 'cpu');
  assert.equal(h.g.sendEmote(h.g.EM.TAUNT), true);
  assert.deepEqual(shown(h), [[0, h.g.EM.TAUNT]]);
  const card = h.g.el3.cardEmotes[0];
  assert.equal(card.textContent, '😈');
  assert.ok(card.classList.contains('show'));

  h.advance(h.g.EMOTE_SHOW_MS + 50);   // frames run drawEmotes and the card clock
  assert.deepEqual(shown(h), [], 'the bubble has gone');
  assert.ok(!card.classList.contains('show'), 'and so has the card copy');
});

test('online it reaches the others, as an index, from the seat that sent it', () => {
  const { host, guest, hs, gs } = liveMatch();
  guest.g.sendEmote(guest.g.EM.CLAP);
  const d = relayLast(gs, hs, 2);
  assert.deepEqual({ e: d.e, turn: d.turn }, { e: 0, turn: guest.g.turnSeq },
    'an index into EMOTES and the turn it is about — never text');
  assert.equal(typeof d.round, 'number');
  assert.deepEqual(shown(host), [[1, 0]], 'over the guest\'s tank');
  assert.deepEqual(shown(guest), [[1, 0]], 'and on the sender\'s own screen');
});

test('anything but one of the eight, or from nobody in the match, is dropped', () => {
  const { host, hs } = liveMatch();
  const round = host.g.online.round;
  for (const e of [8, -1, 2.5, '3', null]) {
    hs.deliver({ t: 'msg', from: 2, d: { k: 'emote', e, turn: 0, round } });
  }
  hs.deliver({ t: 'msg', from: 9, d: { k: 'emote', e: 1, turn: 0, round } });
  hs.deliver({ t: 'msg', from: 2, d: { k: 'emote', e: 1, turn: 0, round: round + 7 } });
  assert.deepEqual(shown(host), []);

  // A seat named in the message is not believed: it is the sender's own.
  hs.deliver({ t: 'msg', from: 2, d: { k: 'emote', e: 1, seat: 0, turn: 0, round } });
  assert.deepEqual(shown(host), [[1, 1]]);
});

test('three in five seconds, then the button says wait', () => {
  const h = load();
  mode(h, 'cpu');
  let sent = 0;
  for (let i = 0; i < 50; i++) if (h.g.sendEmote(i % 8)) sent++;
  assert.equal(sent, h.g.SEND_BURST, 'a flood sends three');
  assert.ok(h.g.el3.reactBtn.classList.contains('cooling'));
  assert.ok(h.g.sendCooldownMs() > 0);

  h.advance(h.g.SEND_WINDOW_MS + 50);
  assert.ok(!h.g.el3.reactBtn.classList.contains('cooling'), 'and recovers on its own');
  assert.equal(h.g.sendEmote(0), true);
});

test('online, a flood never reaches the relay', () => {
  const { guest, gs } = liveMatch();
  for (let i = 0; i < 200; i++) guest.g.sendEmote(i % 8);
  assert.equal(gs.payloads('emote').length, guest.g.SEND_BURST);
});

test('a modified client cannot bury anyone\'s screen', () => {
  const { host, hs } = liveMatch();
  const round = host.g.online.round;
  for (let i = 0; i < 20; i++) hs.deliver({ t: 'msg', from: 2, d: { k: 'emote', e: i % 8, turn: 0, round } });
  assert.ok(host.g.emotes.length <= 3, 'three bubbles over a tank at most');
  // and it stopped taking them at RECV_BURST, well short of twenty
  host.advance(host.g.EMOTE_SHOW_MS + 50);
  assert.deepEqual(shown(host), []);
});

test('a fourth from the same seat pushes the oldest off', () => {
  const h = load();
  mode(h, 'cpu');
  for (const e of [0, 1, 2]) h.g.showEmote(1, e);
  h.g.showEmote(1, 3);
  assert.deepEqual(shown(h), [[1, 1], [1, 2], [1, 3]]);
});

test('a reaction to a shot this screen is still replaying waits for it to land', () => {
  const { host, guest, hs, gs } = liveMatch();
  for (const h of [host, guest]) { h.flatTerrain(400); h.placeTanksAt([200, 700]); h.g.wind = 0; }
  host.g.fire();
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('turn')[0] });   // the guest starts its replay
  assert.ok(host.advanceUntil(() => host.g.state === 'AIMING'), 'the host has seen it land');

  host.g.sendEmote(host.g.EM.MAD);   // about the landing, from a later turn
  relayLast(hs, gs, 1);
  assert.deepEqual(shown(guest), [], 'no spoiler: the guest\'s shell is still in the air');
  assert.equal(guest.g.emoteHold.length, 1);

  assert.ok(guest.advanceUntil(() => guest.g.state === 'AIMING'));
  assert.deepEqual(shown(guest), [[0, 1]], 'shown the moment it lands there too');
});

test('reacting mid-flight is not held: it is about the shot everyone is watching', () => {
  const { host, guest, hs, gs } = liveMatch();
  host.g.fire();
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('turn')[0] });
  host.g.sendEmote(host.g.EM.PLEASE);
  relayLast(hs, gs, 1);
  assert.deepEqual(shown(guest), [[0, 5]]);
});

test('E opens the tray, a number sends from it, Escape closes it', () => {
  const h = load();
  mode(h, 'cpu');
  h.key('e');
  assert.equal(h.g.trayOpen(), true);
  assert.equal(h.g.el3.reactBtn.attributes['aria-expanded'], 'true');
  h.key('2');
  assert.deepEqual(shown(h), [[0, 1]], '2 is 😡');
  assert.equal(h.g.trayOpen(), false, 'sending closes it');
  h.key('3');
  assert.deepEqual(shown(h), [[0, 1]], 'closed, numbers are not reactions');
  h.key('e');
  h.key('Escape');
  assert.equal(h.g.trayOpen(), false);
});

test('the button toggles the tray', () => {
  const h = load();
  mode(h, 'cpu');
  h.g.el3.reactBtn.dispatch('click');
  assert.equal(h.g.trayOpen(), true);
  h.g.el3.reactBtn.dispatch('click');
  assert.equal(h.g.trayOpen(), false);
});

test('REACTIONS off hides the button, ignores everyone, and is remembered', () => {
  const { host, hs } = liveMatch();
  host.g.el3.reactionsSelect.value = 'off';
  host.g.el3.reactionsSelect.dispatch('change');
  assert.equal(host.g.el3.reactCtl.hidden, true);
  hs.deliver({ t: 'msg', from: 2, d: { k: 'emote', e: 1, turn: 0, round: host.g.online.round } });
  assert.deepEqual(shown(host), []);
  assert.equal(host.ctx.localStorage.getItem('barrage.reactions'), 'off');
  assert.equal(host.g.txt('reactions'), 'REACTIONS');
});

// ---------- what a shot did (what the CPU reacts to) ----------

/** A watch over two or three tanks, as the game takes one when a shot starts. */
function watch(g, seat, { blasts = [], downed = false } = {}) {
  return { seat, before: g.tanks.map(t => ({ hp: 100, alive: true, x: t.x })), blasts, downed };
}
const after = (g, changes) => g.tanks.map((t, i) => ({ ...t, hp: 100, alive: true, ...(changes[i] || {}) }));

test('classifying a shot: hits, kills, a self-hit, an aircraft down', () => {
  const h = loadFlat();
  h.placeTanksAt([200, 700]);
  const { g } = h;
  let ev = g.classifyShot(watch(g, 0), after(g, { 1: { hp: 70 } }));
  assert.deepEqual(Array.from(ev.hits, x => [x.seat, x.dmg, x.killed]), [[1, 30, false]]);
  assert.deepEqual(Array.from(ev.kills), []);

  ev = g.classifyShot(watch(g, 0), after(g, { 1: { hp: 0, alive: false } }));
  assert.deepEqual(Array.from(ev.kills), [1]);

  ev = g.classifyShot(watch(g, 0), after(g, { 0: { hp: 80 } }));
  assert.equal(ev.self.dmg, 20);
  assert.equal(ev.hits.length, 0);

  ev = g.classifyShot(watch(g, 0, { downed: true }), after(g, {}));
  assert.equal(ev.downed, true);
  assert.equal(ev.wild, false, 'bringing the helicopter down is not a miss');
});

test('classifying a miss: near, wild, or neither', () => {
  const h = loadFlat();
  h.placeTanksAt([200, 700]);
  const { g } = h;
  const near = g.classifyShot(watch(g, 0, { blasts: [{ x: 740, y: 400, r: 26 }] }), after(g, {}));
  assert.equal(near.nearMiss, true, 'a blast edge a few units from the tank');
  assert.equal(near.wild, false);

  const ordinary = g.classifyShot(watch(g, 0, { blasts: [{ x: 560, y: 400, r: 26 }] }), after(g, {}));
  assert.equal(ordinary.nearMiss, false);
  assert.equal(ordinary.wild, false);

  const wild = g.classifyShot(watch(g, 0, { blasts: [{ x: 250, y: 400, r: 26 }] }), after(g, {}));
  assert.equal(wild.wild, true, 'landed nearer the shooter than the target');
  const offMap = g.classifyShot(watch(g, 0), after(g, {}));
  assert.equal(offMap.wild, true, 'flew off the map');
});


/** Aim `seat` at the other tank with the CPU's own solver, flat and calm. */
function aimAtOther(h) {
  const shot = h.g.chooseAiShot('brutal');
  const t = h.g.tanks[h.g.currentPlayer];
  t.angle = shot.angle;
  t.power = shot.power;
  t.weapon = 'standard';
}


test('nothing is suggested after a shot: reacting is only ever asked for', () => {
  const h = loadFlat();
  mode(h, 'cpu');
  h.flatTerrain(400);
  h.placeTanksAt([200, 700]);
  h.g.wind = 0;
  h.g.currentPlayer = 0;
  h.g.state = 'AIMING';
  aimAtOther(h);
  h.fireAndSettle();
  assert.ok(h.g.tanks[1].hp < 100, 'it hit');
  assert.equal(h.g.trayOpen(), false, 'no tray opens by itself');
  assert.deepEqual(shown(h), [], 'and nothing is sent for you');
});

test('the tray opens on whichever side of the button has more room', () => {
  const h = load();
  mode(h, 'cpu');
  const btn = h.g.el3.reactBtn, tray = h.g.el3.reactTray;
  const at = (top) => { btn.getBoundingClientRect = () => ({ left: 300, top, right: 336, bottom: top + 36, width: 36, height: 36 }); };

  at(600);   // a phone: the button sits above FIRE
  h.g.openTray();
  assert.ok(parseFloat(tray.style.top) < 600, 'above the button');
  const left = parseFloat(tray.style.left);
  assert.ok(left >= 8, 'and on screen');

  h.g.closeTray();
  at(160);   // the desktop rail: room above, but far more below, over nothing
  h.g.openTray();
  assert.ok(parseFloat(tray.style.top) > 196, 'below it, clear of the scores');
});

// ---------- the CPU's reactions, and muting ----------

const evOf = (o) => ({ shooter: 0, hits: [], self: null, kills: [], nearMiss: false, wild: false,
                       downed: false, over: false, winner: -1, ...o });

test('the CPU reacts to being destroyed, a little after the fact', () => {
  const h = load();
  mode(h, 'cpu');
  h.g.setReactRandom(() => 0);   // every roll passes
  h.g.cpuReact(evOf({ hits: [{ seat: 1, dmg: 40, killed: true }], kills: [1] }));
  assert.deepEqual(shown(h), [], 'not instantly');
  h.advance(1200);
  assert.deepEqual(shown(h), [[1, h.g.EM.RIP]]);
});

test('it taunts when it hits you, and flinches when you hit it', () => {
  const h = load();
  mode(h, 'cpu');
  h.g.setReactRandom(() => 0);
  h.g.cpuReact(evOf({ shooter: 1, hits: [{ seat: 0, dmg: 30, killed: false }] }));
  h.advance(1200);
  assert.deepEqual(shown(h), [[1, h.g.EM.TAUNT]]);

  h.advance(h.g.CPU_EMOTE_GAP_MS);
  h.g.cpuReact(evOf({ shooter: 0, hits: [{ seat: 1, dmg: 30, killed: false }] }));
  h.advance(1200);
  assert.deepEqual(shown(h).slice(-1), [[1, h.g.EM.WHOA]]);
});

test('now and then, not every shot', () => {
  const h = load();
  mode(h, 'cpu');
  h.g.setReactRandom(() => 0);
  const hurt = evOf({ shooter: 0, hits: [{ seat: 1, dmg: 30, killed: false }] });
  h.g.cpuReact(hurt);
  h.g.cpuReact(hurt);
  h.advance(1200);
  assert.equal(h.g.emotes.length, 1, 'never twice inside the gap');

  h.advance(h.g.CPU_EMOTE_GAP_MS);
  h.g.setReactRandom(() => 0.99);   // and the odds can say no
  h.g.cpuReact(hurt);
  h.advance(1200);
  assert.equal(h.g.emotes.length, 0);
});

test('a new round cancels a reaction still on its way', () => {
  const h = load();
  mode(h, 'cpu');
  h.g.setReactRandom(() => 0);
  h.g.cpuReact(evOf({ hits: [{ seat: 1, dmg: 40, killed: true }], kills: [1] }));
  h.g.resetGame();
  h.advance(1500);
  assert.deepEqual(shown(h), []);
});

/** Dice that give these values in order, then 0. */
const dice = (values) => { const q = [...values]; return () => (q.length ? q.shift() : 0); };

/** What the CPU says at the end of a round, rolled with these dice. */
function endOfRound(ev, rolls) {
  const h = load();
  mode(h, 'cpu');
  h.g.setReactRandom(dice(rolls));
  h.g.cpuReact(evOf({ over: true, ...ev }));
  h.advance(1200);
  return shown(h);
}

test('a CPU that wins laughs about it as often as it says GG', () => {
  const won = { winner: 1, hits: [{ seat: 0, dmg: 40, killed: true }], kills: [0] };
  assert.deepEqual(endOfRound(won, [0.2]), [[1, 2]], '😂');
  assert.deepEqual(endOfRound(won, [0.7]), [[1, 7]], '🤝');
  assert.deepEqual(endOfRound(won, [0.2, 0.95]), [], 'and sometimes says nothing');
});

test('a CPU that loses is mostly mad or dead about it', () => {
  const lost = { shooter: 0, winner: 0, hits: [{ seat: 1, dmg: 40, killed: true }], kills: [1] };
  assert.deepEqual(endOfRound(lost, [0.1]), [[1, 1]], '😡');
  assert.deepEqual(endOfRound(lost, [0.5]), [[1, 6]], '💀');
  assert.deepEqual(endOfRound(lost, [0.9]), [[1, 7]], 'or, now and then, 🤝');
  assert.deepEqual(endOfRound(lost, [0.1, 0.95]), [], 'and sometimes nothing at all');
});

test('with two CPUs, the one the last shot finished off is the one that sulks', () => {
  const h = load();
  mode(h, 'cpu');
  h.g.el.countSelect.value = '3';
  h.g.el.countSelect.dispatch('change');
  h.g.setReactRandom(dice([0.1]));
  h.g.cpuReact(evOf({ over: true, winner: 0, hits: [{ seat: 2, dmg: 40, killed: true }], kills: [2] }));
  h.advance(1200);
  assert.deepEqual(shown(h), [[2, h.g.EM.MAD]]);
});

test('at the end of a round, reactions are drawn above the round-over screen', () => {
  const h = load();
  mode(h, 'cpu');
  h.g.state = 'GAMEOVER';
  h.g.el.overlay.classList.add('show');
  const onLayer = [], onGame = [];
  h.layerCtx.fillText = (t) => onLayer.push(t);
  const gameCtx = h.g.canvas.getContext('2d');
  const had = gameCtx.fillText;
  gameCtx.fillText = (t) => onGame.push(t);
  h.g.showEmote(1, h.g.EM.GG);
  h.advance(50);   // a frame or two
  gameCtx.fillText = had;
  assert.ok(onLayer.includes('🤝'), 'on the layer that sits over the overlay');
  assert.ok(!onGame.includes('🤝'), 'not on the game canvas underneath it');
});

test('it answers a taunt', () => {
  const h = load();
  mode(h, 'cpu');
  h.g.setReactRandom(() => 0);
  h.g.sendEmote(h.g.EM.TAUNT);
  h.advance(1200);
  assert.deepEqual(shown(h).filter(([seat]) => seat === 1), [[1, h.g.EM.PLEASE]]);
});

test('its dice are its own: reacting never moves the AI\'s aim', () => {
  const h = load();
  mode(h, 'cpu');
  const real = h.ctx.Math.random;
  let draws = 0;
  h.ctx.Math.random = () => { draws++; return real(); };
  h.g.setReactRandom(() => 0);
  h.g.cpuReact(evOf({ shooter: 1, hits: [{ seat: 0, dmg: 30, killed: false }] }));
  h.g.sendEmote(h.g.EM.TAUNT);
  h.ctx.Math.random = real;
  assert.equal(draws, 0);
});

test('the CPU keeps quiet online, all human, or with reactions off', () => {
  const kill = evOf({ hits: [{ seat: 1, dmg: 40, killed: true }], kills: [1] });
  const human = load();
  mode(human, 'human');
  human.g.setReactRandom(() => 0);
  human.g.cpuReact(kill);
  human.advance(1500);
  assert.deepEqual(shown(human), []);

  const off = load();
  mode(off, 'cpu');
  off.g.setReactRandom(() => 0);
  off.g.setReactionsOn(false);
  off.g.cpuReact(kill);
  off.advance(1500);
  assert.deepEqual(shown(off), []);

  const { host } = liveMatch();
  host.g.setReactRandom(() => 0);
  host.g.cpuReact(kill);
  host.advance(1500);
  assert.deepEqual(shown(host), []);
});

test('tap a card to mute that player, and tap again to hear them', () => {
  const { host, hs } = liveMatch();
  const round = host.g.online.round;
  hs.deliver({ t: 'msg', from: 2, d: { k: 'emote', e: 2, turn: 0, round } });
  assert.equal(host.g.emotes.length, 1);

  host.g.el.cards[1].dispatch('click');
  assert.equal(host.g.isMuted(1), true);
  assert.ok(host.g.el.cards[1].classList.contains('muted'), 'the card shows 🔇');
  assert.deepEqual(shown(host), [], 'what they had up goes');
  host.advance(host.g.SEND_WINDOW_MS + 50);   // clear of the receiving limit
  hs.deliver({ t: 'msg', from: 2, d: { k: 'emote', e: 3, turn: 0, round } });
  assert.deepEqual(shown(host), [], 'and nothing new arrives');

  host.g.el.cards[1].dispatch('click');
  assert.equal(host.g.isMuted(1), false);
  hs.deliver({ t: 'msg', from: 2, d: { k: 'emote', e: 4, turn: 0, round } });
  assert.deepEqual(shown(host), [[1, 4]]);
});

test('you cannot mute yourself, and all human there is nothing to mute', () => {
  const { host } = liveMatch();
  assert.equal(host.g.toggleMute(0), false);
  assert.ok(!host.g.el.cards[0].classList.contains('can-mute'));
  assert.ok(host.g.el.cards[1].classList.contains('can-mute'));

  const h = load();
  mode(h, 'human');
  assert.equal(h.g.toggleMute(1), false);
});

test('a mute follows the player through a rematch', () => {
  const { host, guest, hs, gs } = liveMatch();
  host.g.toggleMute(1);
  host.g.el.restartBtn.dispatch('click');
  gs.deliver({ t: 'msg', from: 1, d: hs.payloads('start').slice(-1)[0] });
  assert.equal(host.g.isMuted(1), true);
  guest.g.sendEmote(guest.g.EM.LOL);
  relayLast(gs, hs, 2);
  assert.deepEqual(shown(host), []);
});

test('muting the CPU silences it', () => {
  const h = load();
  mode(h, 'cpu');
  h.g.setReactRandom(() => 0);
  h.g.toggleMute(1);
  h.g.cpuReact(evOf({ hits: [{ seat: 1, dmg: 40, killed: true }], kills: [1] }));
  h.advance(1500);
  assert.deepEqual(shown(h), []);
});
