// Test harness for the Barrage tank game.
//
// The game ships as one self-contained index.html (it is published as a
// single-file page), so there is nothing to import. This module pulls the game
// <script> out of the HTML and runs it in a vm context against a stub DOM: no
// dependencies, no browser, no network. The game exposes its internals through
// the `window.__BARRAGE_TEST__` seam at the bottom of index.html.
//
// Everything that would make a test flaky is under the harness's control:
// Math.random is a seeded PRNG, and time only moves when advance() says so.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

// Re-run the suite against a different world with BARRAGE_SEED=<n>: assertions
// that quietly depend on one particular terrain or wind roll show up as a
// failure rather than passing forever by luck.
const DEFAULT_SEED = Number(process.env.BARRAGE_SEED) || 12345;

// The game script is the one that declares BUILD; the other <script> in the
// page is the tiny pre-boot error reporter.
function gameSource(html) {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const src = blocks.find(b => /const BUILD\s*=/.test(b));
  if (!src) throw new Error('game <script> not found in index.html');
  return src;
}

// Real <option> values, read from the real markup, so a weapon added to the
// page shows up in the stub select without anyone updating this file.
function selectOptions(html) {
  const out = {};
  for (const m of html.matchAll(/<select id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    out[m[1]] = [...m[2].matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)</g)]
      .map(o => ({ value: o[1], textContent: o[3], selected: /\bselected\b/.test(o[2]) }));
  }
  return out;
}

// mulberry32: small, fast, and identical run to run for a given seed.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach(x => this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, on) {
    const want = on === undefined ? !this.set.has(c) : !!on;
    if (want) this.set.add(c); else this.set.delete(c);
    return want;
  }
}

function makeElement(id, opts = {}) {
  const listeners = new Map();
  const el = {
    id,
    tagName: opts.tagName || 'DIV',
    value: opts.value ?? '',
    checked: false,
    disabled: false,
    hidden: false,
    textContent: '',
    innerHTML: '',
    dataset: {},
    style: { setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] ?? ''; }, removeProperty(k) { delete this[k]; } },
    classList: new ClassList(),
    options: opts.options || [],
    children: [],
    offsetParent: null, // nothing is laid out, so the HUD wind pill reads as hidden
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const l = listeners.get(type) || [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    // Tests use this to act like a player: fire the handlers the game bound.
    dispatch(type, event = {}) {
      for (const fn of listeners.get(type) || []) fn({ preventDefault() {}, ...event });
    },
    appendChild(c) { el.children.push(c); return c; },
    setAttribute() {},
    getAttribute() { return null; },
    querySelector: () => makeElement(id + '-child'),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ ...opts.rect }),
    focus() {}, blur() {}, click() { el.dispatch('click', { detail: 1 }); }
  };
  return el;
}

function noopCanvasContext() {
  const gradient = { addColorStop() {} };
  const target = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
    canvas: null
  };
  // Every other 2d call is a no-op that returns undefined; property writes
  // (fillStyle, font, ...) just stick.
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return (t[prop] = () => {});
    },
    set(t, prop, v) { t[prop] = v; return true; }
  });
}

/**
 * Boot a fresh game. Every call is fully isolated: its own vm context, its own
 * clock, its own PRNG.
 *
 * @param {{width?: number, height?: number, seed?: number}} opts
 */
export function load(opts = {}) {
  const width = opts.width ?? 900;
  const height = opts.height ?? 500;
  const seed = opts.seed ?? DEFAULT_SEED;

  const rect = { width, height, left: 0, top: 0, right: width, bottom: height };
  const optionSets = selectOptions(HTML);
  const elements = new Map();

  const makeById = (id) => {
    const opts = { rect };
    if (optionSets[id]) {
      opts.tagName = 'SELECT';
      // Options carry remove(), because pruneWeaponOptions() drops the
      // <option>s for weapons that are switched off.
      const list = optionSets[id].map(o => ({ ...o, disabled: false }));
      for (const o of list) o.remove = () => { const i = list.indexOf(o); if (i >= 0) list.splice(i, 1); };
      opts.options = list;
      const sel = opts.options.find(o => o.selected) || opts.options[0];
      opts.value = sel ? sel.value : '';
    }
    if (id === 'angle-slider') opts.value = '45';
    if (id === 'power-slider') opts.value = '55';
    return makeElement(id, opts);
  };

  const document = {
    documentElement: makeElement('html', { rect }),
    body: makeElement('body', { rect }),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeById(id));
      return elements.get(id);
    },
    createElement(tag) { return makeElement('', { tagName: tag.toUpperCase(), rect }); },
    querySelector(sel) { return makeElement(sel, { rect }); },
    querySelectorAll() { return []; },
    addEventListener() {}
  };

  // Fake clock. Timers and animation frames only run inside advance().
  let now = 0;
  let timerId = 1;
  const timers = new Map();   // id -> {due, fn, interval}
  const frames = [];          // pending requestAnimationFrame callbacks

  const clock = {
    get now() { return now; },
    setTimeout(fn, ms = 0) {
      const id = timerId++;
      timers.set(id, { due: now + ms, fn, interval: null });
      return id;
    },
    setInterval(fn, ms = 0) {
      const id = timerId++;
      timers.set(id, { due: now + ms, fn, interval: Math.max(1, ms) });
      return id;
    },
    clear(id) { timers.delete(id); },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; }
  };

  const canvasCtx = noopCanvasContext();
  const canvas = document.getElementById('game');
  canvas.getContext = () => canvasCtx;
  canvas.width = width;
  canvas.height = height;

  let random = mulberry32(seed);

  const windowStub = {
    devicePixelRatio: 1,
    innerWidth: width,
    innerHeight: height,
    visualViewport: null,
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '#ff7a45' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    localStorage: {
      store: new Map(),
      getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
      setItem(k, v) { this.store.set(k, String(v)); },
      removeItem(k) { this.store.delete(k); }
    },
    navigator: { language: 'en-US' },
    performance: { now: () => now }
  };

  const sandbox = {
    window: windowStub,
    document,
    console: { log() {}, warn() {}, error() {} },
    Math: Object.create(Math),
    JSON, Date, Infinity, NaN, isFinite, isNaN, parseInt, parseFloat, Set, Map, Array, Object
  };
  sandbox.Math.random = () => random();
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.navigator = windowStub.navigator;
  sandbox.performance = windowStub.performance;
  sandbox.localStorage = windowStub.localStorage;
  sandbox.getComputedStyle = windowStub.getComputedStyle;
  sandbox.requestAnimationFrame = clock.requestAnimationFrame;
  sandbox.cancelAnimationFrame = () => {};
  sandbox.setTimeout = clock.setTimeout;
  sandbox.clearTimeout = clock.clear;
  sandbox.setInterval = clock.setInterval;
  sandbox.clearInterval = clock.clear;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(gameSource(HTML), ctx, { filename: 'index.html' });

  const g = ctx.window.__BARRAGE_TEST__;
  if (!g) throw new Error('__BARRAGE_TEST__ seam missing — did the seam block in index.html move?');

  const api = {
    g,
    ctx,
    /** Replace Math.random with a fresh seeded sequence. */
    seedRandom(s) { random = mulberry32(s); },
    /** Serve these values from Math.random in order, then fall back to the PRNG. */
    queueRandom(values) {
      const queue = [...values];
      const base = random;
      random = () => (queue.length ? queue.shift() : base());
    },
    /** Freeze Math.random at one value — handy for "never take the random branch". */
    fixRandom(v) { random = () => v; },
    get now() { return now; },

    /**
     * Move the clock forward, running due timers and animation frames.
     * Frames are served at a fixed 16ms so physics steps are reproducible.
     */
    advance(ms, stepMs = 16) {
      const end = now + ms;
      while (now < end) {
        const next = Math.min(end, now + stepMs);
        // timers due in this slice, in due order
        let due = [...timers.entries()].filter(([, t]) => t.due <= next).sort((a, b) => a[1].due - b[1].due);
        while (due.length) {
          for (const [id, t] of due) {
            now = Math.max(now, t.due);
            if (t.interval === null) timers.delete(id); else t.due = now + t.interval;
            t.fn();
          }
          due = [...timers.entries()].filter(([, t]) => t.due <= next).sort((a, b) => a[1].due - b[1].due);
        }
        now = next;
        const pending = frames.splice(0, frames.length);
        for (const fn of pending) fn(now);
      }
    },

    /** Flat ground at y, so trajectory and damage assertions are exact. */
    flatTerrain(y = 400) {
      g.terrain = new Array(g.W).fill(y);
      return y;
    },

    /** Put tanks at exact x positions (and re-level the ground under them). */
    placeTanksAt(xs) {
      xs.forEach((x, i) => { if (g.tanks[i]) g.tanks[i].x = x; });
      return g.tanks;
    },

    /** Fire the current seat and run frames until the turn resolves. */
    fireAndSettle({ maxMs = 30000 } = {}) {
      g.fire();
      const start = now;
      while (now - start < maxMs && g.state !== 'AIMING' && g.state !== 'GAMEOVER') {
        api.advance(16);
      }
      return g.state;
    },

    /** Run frames until predicate() is true or the budget runs out. */
    advanceUntil(predicate, { maxMs = 30000 } = {}) {
      const start = now;
      while (now - start < maxMs && !predicate()) api.advance(16);
      return predicate();
    },

    el(id) { return document.getElementById(id); }
  };

  // The game kicks off a render loop and two deferred resizes at boot; run them
  // so every test starts from the same settled state.
  api.advance(500);
  return api;
}

/** A two-human game on flat ground with no wind: the most predictable setup. */
export function loadFlat(opts = {}) {
  const h = load(opts);
  h.g.cpuMode = false;
  h.g.resetGame();
  h.flatTerrain(opts.groundY ?? 400);
  h.g.wind = 0;
  h.g.tanks.forEach(t => { t.hp = 100; t.alive = true; });
  h.g.state = 'AIMING';
  return h;
}
