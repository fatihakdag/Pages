// Screenshot index.html at the viewports the layout has to survive.
//
// The game is a static file, so this needs no server and no dependencies — just
// a Chrome already on the machine, driven over the DevTools protocol with
// Node's built-in WebSocket. Use it to *see* a CSS or render change instead of
// assuming it worked.
//
//   node tools/shots.mjs                        # every viewport -> /tmp/barrage-shots
//   node tools/shots.mjs portrait desktop       # just these
//   node tools/shots.mjs --out shots/           # somewhere else
//   node tools/shots.mjs --page multiplayer/index.html   # the online build
//
// Chrome's --window-size flag is not usable here: Chrome clamps it, so a
// "390px" window lays out at 500px and the screenshot is a crop of the wrong
// layout. Emulation.setDeviceMetricsOverride sets the real layout viewport, and
// it can also emulate touch, which the page's `pointer: coarse` rules need.
//
// Console errors from the page are reported: a shot that "looks fine" while the
// game threw during boot is worth knowing about.

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// These mirror the @media breakpoints in the <style> block of index.html.
const VIEWPORTS = {
  desktop:           { w: 1440, h: 900,  touch: false, note: 'default layout' },
  laptop:            { w: 1280, h: 800,  touch: false, note: 'default layout, tighter' },
  tablet:            { w: 820,  h: 1180, touch: true,  note: 'portrait rules, coarse pointer' },
  portrait:          { w: 390,  h: 844,  touch: true,  note: 'phone: abbreviated HUD, stacked controls' },
  'portrait-small':  { w: 320,  h: 568,  touch: true,  note: 'narrowest supported' },
  'landscape-short': { w: 844,  h: 390,  touch: true,  note: 'controls move to side rails' },
  'landscape-tiny':  { w: 667,  h: 375,  touch: true,  note: 'ultra-short landscape, tightened rails' }
};

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

function parseArgs(argv) {
  const names = [];
  let out = process.env.BARRAGE_SHOT_DIR || join(tmpdir(), 'barrage-shots');
  let page = 'index.html';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '-o') out = argv[++i];
    else if (a === '--page' || a === '-p') page = argv[++i];
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else if (a.startsWith('-')) { console.error(`unknown option: ${a}`); process.exit(2); }
    else if (!(a in VIEWPORTS)) { console.error(`unknown viewport: ${a}`); usage(); process.exit(2); }
    else names.push(a);
  }
  return { names: names.length ? names : Object.keys(VIEWPORTS), out, page };
}

function usage() {
  console.log('usage: node tools/shots.mjs [--out DIR] [--page FILE] [viewport...]\n\nviewports:');
  for (const [name, v] of Object.entries(VIEWPORTS)) {
    console.log(`  ${name.padEnd(16)} ${String(v.w + 'x' + v.h).padEnd(10)} ${v.note}`);
  }
}

/** Wait for Chrome to write its port, then return the browser WebSocket URL. */
async function browserWsUrl(userDataDir, deadline = Date.now() + 15000) {
  const portFile = join(userDataDir, 'DevToolsActivePort');
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const [port, path] = (await readFile(portFile, 'utf8')).split('\n');
      if (port && path) return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('Chrome never reported a debugging port');
}

/** Minimal CDP client over one WebSocket, with per-session message routing. */
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const listeners = [];
  let nextId = 1;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : ok(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });

  const ready = new Promise((ok, bad) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', () => bad(new Error('could not reach Chrome')), { once: true });
  });

  return {
    ready,
    on(fn) { listeners.push(fn); },
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((ok, bad) => {
        pending.set(id, { resolve: ok, reject: bad });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() { ws.close(); }
  };
}

const { names, out, page } = parseArgs(process.argv.slice(2));

const chrome = CHROME_CANDIDATES.find(p => existsSync(p));
if (!chrome) {
  console.error('No Chrome found. Set CHROME=/path/to/chrome (any Chrome or Chromium works).');
  process.exit(1);
}

const userDataDir = await mkdtemp(join(tmpdir(), 'barrage-chrome-'));
const proc = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  `--user-data-dir=${userDataDir}`,
  'about:blank'
], { stdio: 'ignore' });

let failed = false;
try {
  const cdp = connect(await browserWsUrl(userDataDir));
  await cdp.ready;

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  // Console errors are collected per shot, then reported alongside it.
  let errors = [];
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
  });
  // One load listener for the whole run: registering a fresh one per shot would
  // leave every earlier one live, and the wrong promise would win.
  let onLoad = null;
  cdp.on((msg) => {
    if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired' && onLoad) {
      const fn = onLoad; onLoad = null; fn();
    }
  });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);

  await mkdir(out, { recursive: true });

  for (const name of names) {
    const v = VIEWPORTS[name];
    errors = [];
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.touch
    }, sessionId);
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: v.touch, maxTouchPoints: 5   // ignored when enabled is false, but must be 1..16
    }, sessionId);

    const loaded = new Promise((ok) => { onLoad = ok; });
    await cdp.send('Page.navigate', { url: `file://${join(ROOT, page)}` }, sessionId);
    await loaded;
    // The game re-measures on timers at 60ms and 400ms after boot; wait past
    // both so the canvas in the shot is the settled layout, not the first paint.
    await new Promise(r => setTimeout(r, 700));

    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = join(out, `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));

    // Trust but verify: Chrome has clamped viewports before.
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: 'innerWidth + "x" + innerHeight', returnByValue: true
    }, sessionId);
    const actual = result.value;
    const want = `${v.w}x${v.h}`;
    console.log(`${file}  ${actual}${actual === want ? '' : `  (WANTED ${want})`}`);
    if (actual !== want) failed = true;
    for (const e of errors) { console.log(`  page error: ${e}`); failed = true; }
  }

  cdp.close();
} finally {
  // Let Chrome finish tearing down its profile before removing it, or the
  // rmdir races the files it is still writing.
  const exited = new Promise(ok => proc.once('exit', ok));
  proc.kill();
  await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}

process.exit(failed ? 1 : 0);
