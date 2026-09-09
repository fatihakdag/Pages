# Barrage online — agent guide

The online build. `multiplayer/index.html` is a fork of the single-player game
at the repo root; read [../AGENTS.md](../AGENTS.md) first — the map of the file,
the core model and the conventions all still apply. This file covers only what
is different here.

```
index.html      the game, forked from the root copy
tests/          the same suite, run against this index.html
server/         the match relay (its own package — the only dependency here)
```

```bash
npm run test:mp       # this game's suite
npm run test:relay    # the relay's suite
npm run relay         # start the relay; it also serves this index.html
npm run shots -- --page multiplayer/index.html
```

All five commands are run from the repo root.

## What differs from the single-player build

**The simulation is in world units, not canvas pixels.** This is the whole
reason the fork exists. In the root build the terrain array is one entry per
screen pixel and physics is scaled by canvas width, so a 1440px desktop and a
390px phone hold different worlds and the same shot lands in different places —
two players cannot share a battlefield.

Here the world is a fixed `SIM_W` × `SIM_H` (1000 × 620) battlefield and the
canvas is only a window onto it, described by `viewScale`:

- Draw calls are in **world units** by default, via a canvas transform, so the
  rendering code reads the same as the root build's.
- `screenTransform()` switches to CSS pixels for on-canvas UI that has to stay
  legible whatever size the world is drawn at — currently the wind gauge.
  `worldTransform()` switches back. Anything drawn in screen space must have its
  hit-testing in screen space too (see `windGaugeRect`).
- `eventToWorld(e)` converts a pointer event to world units.
- **Resizing must never touch the world.** It only recomputes `viewScale`. The
  root build regenerates terrain from the seed shape on resize, which erases
  every crater — that is the bug this design removes.
- A `ResizeObserver` on `#game-wrap` drives resizing, because the canvas is
  sized purely in JS here; a missed measurement leaves the playfield visibly
  wrong rather than merely blurry.
- The world's shape being fixed, `#game-wrap` carries that aspect in CSS and
  `#controls` takes the slack, so unusable space becomes spacing between touch
  targets instead of black bars.

Reshaping the battlefield means changing `SIM_W` / `SIM_H` and nothing else.

### The camera

A fixed-shape world is necessarily drawn small on a phone — about 390×242 in
portrait — so the view can be zoomed and panned. `camZoom` 1 fits the whole
world; above that `camX`/`camY` are the world coordinates of the view's
top-left corner, clamped so the view can never leave the world.

The camera is **only a way of looking**. It must never reach the simulation:
two players zoomed differently still hold the same battlefield and the same
shot lands in the same place, and there is a test for exactly that. Everything
it touches lives in `worldTransform()` and `eventToWorld()`.

- One finger drags, two fingers pinch, the wheel zooms about the cursor, and
  three buttons over the playfield do the same for anyone not on a touch
  screen. Pointer events cover all three input kinds in one path, and the
  canvas carries `touch-action: none` so the browser does not scroll the page
  out from under a gesture.
- `camFollow()` runs each frame: zoomed in, it eases onto the shell while one
  is in the air and onto whoever is aiming between turns — without it, zoom is
  useless, because firing loses the shell immediately.
- A deliberate pan sets `camPanned` and owns the camera until the turn changes,
  so following never yanks the view away from someone looking on purpose.

## The relay

`server/relay.mjs` is deliberately dumb: it knows about rooms and sockets and
nothing about artillery. Clients send `msg` frames and it hands them to the rest
of the room untouched, so the game stays in `index.html` and there is no second
copy of the physics to keep in sync.

| Client → relay | Relay → client |
|---|---|
| `join` — create a room, or join a code | `joined` — code, your id, host, who is already here |
| `msg` — payload relayed verbatim | `peer` / `gone` — arrivals and departures, host handed on |
| `bye` | `msg` — `{from, d}` |
| | `err` — `NO_ROOM`, `ROOM_FULL`, `BAD_VERSION`, `RATE`, … |

- Bump `PROTOCOL` when the message shape changes; clients are checked on join
  so a stale one refuses to pair rather than desyncing later.
- Room codes avoid `O`/`0`, `I`/`1`, `S`/`5` — they get read aloud and typed.
- A departure is **reported, not interpreted**. The game decides whether that
  means handing the tank to the AI or waiting for a rejoin.
- It serves this `index.html` on the same port for local play; `SERVE_GAME=0`
  turns that off for production, where the page is static and only the socket
  comes from here.

Its own package, so the game itself stays dependency-free and the root
`npm test` still needs no install.

**It runs as exactly one machine.** Rooms are an in-memory `Map`, so a room
exists only on the process that created it. Deployed with Fly's default of two
machines, joins round-robin and about half get `NO_ROOM` from a machine that
never heard of the room — the symptom is a lobby that works intermittently.
`fly.toml` pins `max_machines_running = 1` and CI deploys with `--ha=false`.
Scaling out means moving rooms out of process memory first, or pinning each
room to a machine with `fly-replay`.

## The client side

`// ---------- Online ----------` in `index.html`. A match carries two messages
per turn:

- **`turn`** — `{seat, angle, power, weapon}`, sent by `fire()` *before* the
  shell is simulated, so the other client watches the same flight rather than
  having the result appear.
- **`sync`** — the full state, sent from `nextTurn()` by the seat that just
  played. This is what actually decides the outcome: small divergences in the
  replay are erased every turn instead of accumulating, so the clients cannot
  drift apart. A `sync` that lands mid-flight is held in `online.pendingSync`
  and applied when the turn resolves — snapping immediately would cut the shot
  off on screen.

`nextTurn()` captures `actor` before advancing, because by the time the result
is published `currentPlayer` is already the *next* seat.

Other things worth knowing:

- `netRemoteSeat(i)` is the counterpart to `isAi(i)`: a seat somebody else
  drives locks the turn controls exactly like a CPU seat does.
- The host deals seats in join order and hands out the world in the `start`
  message, so nothing depends on the two clients generating the same terrain.
- `netSnapshot()` maps `Infinity` ammo to `-1`, because the standard shell's
  ammo is `Infinity` and JSON cannot carry it.
- `socketFactory` is overridable through the seam (`setSocketFactory`), which
  is how `tests/online.test.mjs` drives the whole protocol without a socket.
- The relay URL is the page's own origin, overridable with `?relay=ws://…`.

## Known gaps

- **A backgrounded tab stalls the match.** Browsers throttle `requestAnimation-
  Frame` in hidden tabs, so that player's game loop stops — and because only the
  seat that played publishes authority, the other client waits forever. A turn
  timer, and letting the AI take an unresponsive seat, is the fix.
- Verified end to end against the deployed relay: two browser pages join a
  room, hold identical terrain and wind, and after a shot agree on the crater,
  the wind roll and whose turn it is. Frames had to be pumped by hand
  (`requestAnimationFrame` neutered, `step()` driven from a counter) because
  headless Chrome throttles whichever page is not in front — the same
  throttling as the backgrounded-tab gap above.
- The opponents select still reads "vs CPU" during a match; it should show and
  lock to the online roster.

## Still to build

- **Robustness.** A turn timer; reconnecting to a match in progress; a
  disconnect handing the seat to the existing AI rather than ending the round.
  These are what close the backgrounded-tab gap above.
- **Authority for everything a turn rolls.** `setWind()`, helicopter spawning
  and the double-click `summonHeli()` are all `Math.random()` today. Wind
  survives because the snapshot carries it, but the helicopter does not: it runs
  on a wall clock (`heliTimer`, in seconds) that means nothing across two
  machines, and a locally summoned one is a private hallucination. Tie it to
  turn count and put it in the snapshot.
- **More than two seats.** The protocol deals N seats already, but the host
  hard-codes a two-player match.
