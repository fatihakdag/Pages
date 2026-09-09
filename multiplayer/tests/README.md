# Tests

The game is one self-contained `index.html` — it is published as a single-file
page, so there is no build step and nothing to import. `harness.mjs` pulls the
game `<script>` out of the HTML and runs it in a `node:vm` context against a
stub DOM (elements, a no-op 2d canvas, a fake clock, a seeded `Math.random`).
No dependencies, no browser.

```bash
node --test "tests/*.test.mjs"
```

Or with a different world, to shake out assertions that only hold for one
terrain or wind roll:

```bash
BARRAGE_SEED=777 node --test "tests/*.test.mjs"
```

## How tests reach the game

`index.html` ends with a `window.__BARRAGE_TEST__` block that exposes the
functions and mutable state. Nothing in the game reads it. When you add a
function worth testing, add it there.

## Writing a test

```js
import { loadFlat } from './harness.mjs';

const h = loadFlat();     // two humans, flat ground, no wind
h.placeTanksAt([200, 700]);
h.g.tanks[0].angle = 45;
h.fireAndSettle();        // runs frames until the turn resolves
```

- `load(opts)` boots a fresh game (`width`, `height`, `seed`); every call is
  isolated.
- Time only moves inside `h.advance(ms)` / `h.advanceUntil(fn)`, so nothing is
  clock-dependent.
- `h.seedRandom(n)`, `h.queueRandom([...])` and `h.fixRandom(v)` pin the random
  branches (AI jitter, helicopter hunting, terrain).
- Values come out of the vm context, so compare with `Array.from(...)` rather
  than `deepStrictEqual` on a vm-side array.
