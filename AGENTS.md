# Barrage — agent guide

A single-file, dependency-free artillery game (Scorched Earth style). Two to four
tanks take turns lobbing shells across destructible terrain, with wind, weapons,
themes and an optional helicopter to shoot down.

**`index.html` is the entire app** — markup, CSS and the game script in one file,
~2850 lines, published as a static page. There is no build step, no bundler, no
package to install. `package.json` exists only to run the tests and the screenshot tool.

Read this file first; it is a map so you don't have to read all of `index.html`.

## Layout

```
index.html         the whole game (see map below)
tests/             node:test suite; tests/README.md explains the harness
tests/harness.mjs  boots index.html in a node:vm against a stub DOM
tools/shots.mjs    screenshots a page at every breakpoint (npm run shots)
tools/manifest.mjs generates the root page's inline home-screen install block
tools/icons.mjs    draws multiplayer/icon-*.png with the game's own drawTank
multiplayer/       the online build — its own game, tests and relay
.claude/           permission allowlist for read-only and test commands
.github/workflows/ CI: node --test "tests/*.test.mjs"
.gitlab-ci.yml     same test job + a pages deploy stage
```

## Two builds

`index.html` at the root is the single-player game and is **frozen in shape**:
it is the version that ships to Pages today. `multiplayer/` is a fork of it
being taken online, with its own `index.html`, its own copy of the suite, and
the match relay. See [multiplayer/AGENTS.md](multiplayer/AGENTS.md) for what
differs — the short version is that its simulation runs in fixed world units
rather than canvas pixels, which is what lets two clients share a battlefield.

A change that belongs to both has to be made in both. That duplication is the
deliberate cost of leaving the shipping game alone while the online one moves.

## Map of index.html

The script is divided by `// ---------- X ----------` markers. One command
prints the whole index with current line numbers:

```bash
grep -n '// ----------' index.html
```

So this table gives anchors, not line numbers — an anchor stays correct as the
file moves. Sizes are approximate, to tell you what you are about to read.

| What | Find it | ~lines |
|---|---|---|
| Styles: HUD, controls, responsive rules (portrait, short screens, landscape side rails) | `<style>` | 530 |
| Markup: player cards, `#game` canvas, overlay, controls, selects | `<body>` | 110 |
| Pre-boot error reporter and `--vh` fix — a *separate* small script | `function showError` | 30 |
| The game: one IIFE, everything below is inside it | `const BUILD` | — |
| `MISSILE` guided-missile tuning, with one `enabled` switch | `Guided missile: one switch` | 25 |
| DOM element handles | `const canvas = document` | 25 |
| Language: `STRINGS` (en/tr), `txt()`, `applyLanguage()` | `Language ---` | 165 |
| Canvas sizing, `resize()`, `physScale` | `Canvas sizing` | 55 |
| `THEMES` (7 environments) and decor (stars/clouds/embers/snow/dust) | `Environments` | 120 |
| Terrain heightmap, `craterAt()`, `groundHeightAt()` | `Terrain ---` | 85 |
| `WEAPONS`, tanks, wind, HUD sync, `fire()`, damage, turns | `Game state` | 435 |
| AI: `predictLandingX()`, `chooseAiShot()`, `DIFFICULTY_SETTINGS` | `AI: trajectory` | 215 |
| Roller mine / MIRV split / guided-missile flight | `Roller mine` | 170 |
| `stepProjectile()` — per-shell flight, collision, detonation | `Per-shell flight` | 100 |
| `step(ts)` — the frame loop and the state machine | `Physics step` | 75 |
| Rendering: decor, helicopter, tanks | `Rendering ---` | 315 |
| Wind streaks and gauge, aim preview, `render()` | `Wind indicators` | 290 |
| Boot sequence | `Boot ---` | 20 |
| `window.__BARRAGE_TEST__` test seam | `Test seam` | 40 |

For anything finer-grained, grep the declaration directly — `grep -n 'function
chooseAiShot' index.html` is exact and self-verifying in a way a line number in
a document never is.

## Core model

- **Turn machine.** `state` is `AIMING → FIRING → EXPLODING → RESOLVED → AIMING`,
  plus `GAMEOVER`. `RESOLVED` calls `nextTurn()`. A shot that hits nothing skips
  `EXPLODING`. `turnToken` invalidates AI callbacks when a turn changes underneath
  them.
- **Terrain** is a heightmap array indexed by x pixel; the value is the y of the
  ground surface. Destruction is `craterAt()` writing into that array, clamped at
  `bedrockY()`.
- **Angles** are world degrees, 0 = right, 180 = left. The angle slider is
  inverted (`angleToSlider` / `sliderToAngle`) so dragging left aims left.
- **Scaling.** All physics constants are authored for `W_REF = 1000` and
  multiplied by `physScale`, so gameplay is identical on any canvas size.
- **Weapons** live in one `WEAPONS` table; behaviour flags (`rolls`, `guides`,
  `clusterCount`, `mirvCount`) select the special paths. `startAmmo: Infinity`
  is the standard shell.
- **AI** brute-forces angle/power through `predictLandingX()` and then adds
  difficulty-scaled jitter — it does not cheat.

## Working on it

- Keep it one file with no dependencies. Nothing may be added that needs a build
  step or a network fetch.
- Adding a weapon means: an entry in `WEAPONS`, an `<option>` in `#weapon-select`,
  a `w_<key>` string in both languages, and any special-case branch in
  `stepProjectile()`. The test harness picks up the new `<option>` automatically.
- Every user-facing string goes through `txt()` and needs an **en and a tr**
  entry. Turkish uppercasing uses `upper()`, not `toUpperCase()`.
- Bump `BUILD` (the top of the game script) when shipping a visible change; it
  renders in the HUD.
- Expose anything worth testing on `window.__BARRAGE_TEST__` at the bottom of the
  file — that is the only seam tests have.

## Tests

```bash
npm test
```

```bash
BARRAGE_SEED=777 npm test
```

The suite runs the real game out of `index.html` inside a `node:vm` with a stub
DOM, a fake clock and a seeded `Math.random`, so it is fully deterministic. See
[tests/README.md](tests/README.md) before writing one. Run the suite after any
change to the script — it is fast and it is the only safety net here.

## Visual check

CSS and rendering changes are not covered by the tests — screenshot them:

```bash
npm run shots
```

```bash
npm run shots -- portrait landscape-short --out shots/
```

It drives a local Chrome headless over the DevTools protocol (no dependencies,
no server) and writes one PNG per viewport to `/tmp/barrage-shots`, covering
every `@media` breakpoint in the page: `desktop`, `laptop`, `tablet`,
`portrait`, `portrait-small`, `landscape-short`, `landscape-tiny`. Phone and
tablet viewports emulate touch, so the `pointer: coarse` rules apply. It exits
non-zero and says so if the page logged an error or Chrome refused a viewport,
so a shot that looks fine while the game threw during boot does not slip past.

Read the PNGs — that is the point of them. `--out` puts them somewhere you can
keep. Still worth doing by hand: 3–4 player mode and an actual game in motion,
which a single frame cannot show.
