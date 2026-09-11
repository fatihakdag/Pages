// Render the home-screen icons for the online build.
//
//   node tools/icons.mjs        # rewrite multiplayer/icon-*.png
//
// The icon is the game's actual tank, not a drawing of one: `drawTank` and
// `pillPath` are lifted out of multiplayer/index.html as source and run against
// a real canvas in a headless Chrome, on the sky and ground gradients of the
// game's own first theme. Restyle the tank in the game and the icon follows;
// there is no second copy of the artwork to keep in sync.
//
// That is also why this needs Chrome rather than a rasteriser of its own: the
// tank is arcs, round-capped strokes and translucent overlays, and only a real
// canvas draws those the way the game does. Same rule as tools/shots.mjs — any
// Chrome already on the machine will do, nothing to install.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GAME = join(ROOT, 'multiplayer', 'index.html');
const OUT = join(ROOT, 'multiplayer');

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

// The tank's colour is a player accent; the sky and ground are the first theme,
// Dusk Ridge, which is what the game opens on.
const TANK_COLOR = '#ff7a45';
const SKY_TOP = '#2b3a55', SKY_BOT = '#7d5a6e';
const GROUND_1 = '#4a3728', GROUND_2 = '#2e2118';
const RIM = 'rgba(255,200,150,0.20)';

/** Pull one `function name(...) {...}` out of the game by matching its braces. */
function lift(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in multiplayer/index.html`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} has no closing brace`);
}

const html = await readFile(GAME, 'utf8');
const tankSize = html.match(/const TANK_W = (\d+(?:\.\d+)?), TANK_H = (\d+(?:\.\d+)?)/);
if (!tankSize) throw new Error('TANK_W / TANK_H not found in multiplayer/index.html');

// The scene, drawn in a 128-unit square and scaled to whatever the icon is.
// `inset` is the fraction of each edge kept clear: a maskable icon may be
// cropped to a circle or a squircle, so the artwork shrinks inside it while the
// sky and ground still run to the edges.
const SCENE = `(size, inset) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const TANK_W = ${tankSize[1]}, TANK_H = ${tankSize[2]};

  // What drawTank reaches for besides its argument. The tank is placed by the
  // transform below, so the ground under it is simply y = 0.
  const groundHeightAt = () => 0;
  ${lift(html, 'pillPath')}
  ${lift(html, 'drawTank')}

  const D = 128;                          // design units
  const pad = size * inset;
  const s = (size - pad * 2) / D;
  const horizon = 86;                     // where the ground starts, in design units

  // Sky and ground bleed past the inset so a crop never exposes a corner.
  const bleed = pad / s;
  const L = -bleed, R = D + bleed, T = -bleed, B = D + bleed;
  ctx.setTransform(s, 0, 0, s, pad, pad);

  const sky = ctx.createLinearGradient(0, T, 0, horizon);
  sky.addColorStop(0, '${SKY_TOP}');
  sky.addColorStop(1, '${SKY_BOT}');
  ctx.fillStyle = sky;
  ctx.fillRect(L, T, R - L, B - T);

  // A ridge with the game's own profile: a couple of sine terms, filled with
  // the ground gradient and rimmed with light, exactly as the playfield is.
  ctx.beginPath();
  ctx.moveTo(L, B);
  for (let x = L; x <= R; x += 1) {
    const y = horizon + 7 * Math.sin(x / 34) + 3 * Math.sin(x / 11 + 1.4);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(R, B);
  ctx.closePath();
  const ground = ctx.createLinearGradient(0, horizon - 10, 0, B);
  ground.addColorStop(0, '${GROUND_1}');
  ground.addColorStop(1, '${GROUND_2}');
  ctx.fillStyle = ground;
  ctx.fill();
  ctx.strokeStyle = '${RIM}';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // The tank, drawn by the game's own code. It is ~26 units wide in world
  // terms and the icon is 128 across, so it is scaled up to fill the frame.
  const tx = 46;
  const ty = horizon + 7 * Math.sin(tx / 34) + 3 * Math.sin(tx / 11 + 1.4);
  ctx.save();
  ctx.translate(tx, ty);
  ctx.scale(2.15, 2.15);
  drawTank({ x: 0, angle: 42, color: '${TANK_COLOR}', alive: true });
  ctx.restore();

  return c.toDataURL('image/png').slice('data:image/png;base64,'.length);
}`;

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('No Chrome found. Set CHROME=/path/to/chrome (any Chrome or Chromium works).');
  process.exit(1);
}

const userDataDir = await mkdtemp(join(tmpdir(), 'barrage-icons-'));
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank',
], { stdio: 'ignore' });

/** Wait for Chrome to write its port, then return the browser WebSocket URL. */
async function browserWsUrl(deadline = Date.now() + 15000) {
  for (;;) {
    try {
      const [port, path] = (await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8')).split('\n');
      if (port && path) return `ws://127.0.0.1:${port}${path}`;
    } catch { /* not written yet */ }
    if (Date.now() > deadline) throw new Error('Chrome never reported a debugging port');
    await new Promise((r) => setTimeout(r, 100));
  }
}

let failed = false;
try {
  const ws = new WebSocket(await browserWsUrl());
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('could not connect to Chrome')), { once: true });
  });

  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const n = ++id;
    waiting.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);

  for (const [name, size, inset] of [
    ['icon-192.png', 192, 0],
    ['icon-512.png', 512, 0],
    ['icon-maskable-512.png', 512, 0.1],
  ]) {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression: `(${SCENE})(${size}, ${inset})`,
      returnByValue: true,
    }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || 'draw failed');
    await writeFile(join(OUT, name), Buffer.from(result.value, 'base64'));
    console.log('wrote:', name, `${size}x${size}`);
  }
} catch (err) {
  failed = true;
  console.error(err.message);
} finally {
  proc.kill();
  await rm(userDataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
