# Barrage online — agent guide

The online build. `multiplayer/index.html` is a fork of the single-player game
at the repo root; read [../AGENTS.md](../AGENTS.md) first — the map of the file,
the core model and the conventions all still apply. This file covers only what
is different here.

```
index.html           the game, forked from the root copy
sound.js             the synthesised sound, lifted out of the root's Sound section
manifest.webmanifest what makes it installable to a home screen
sw.js                service worker: offline start, and Chrome's install prompt
icon-*.png           launcher icons, from `node tools/icons.mjs` at the root
tests/               the same suite, run against this index.html
server/              the match relay (its own package — the only dependency here)
```

```bash
npm run test:mp       # this game's suite
npm run test:relay    # the relay's suite
npm run relay         # start the relay; it also serves this index.html
npm run shots -- --page multiplayer/index.html
```

All five commands are run from the repo root.

## Installing it

The root build keeps its whole install setup inside index.html as a data: URL,
because it ships as a single file. This one does not have to: the relay serves
it from its own origin, so the manifest and the icons are real files, and there
is a service worker — which can never be inlined, and which is what makes
Chrome offer a true install rather than a bookmark. `display: standalone` in
the manifest is what drops the address bar.

The icons are not a separate drawing of a tank: `tools/icons.mjs` lifts
`drawTank` and `pillPath` out of this index.html and runs them against a real
canvas in a headless Chrome, over the first theme's sky and ground gradients.
Restyle the tank in the game and the icon follows on the next run — but it does
have to be run, and nothing notices if it is not.

The service worker is network-first for the page and cache-first for the icons,
so an installed copy still picks up a deploy but starts with no signal. It
never sees the match: that is a WebSocket, and there is no offline mode for an
online game. Three things have to agree, and nothing fails loudly if they do
not — the file list in `sw.js`, the `COPY` lines in the Dockerfile, and the
icons in the manifest. Bump `VERSION` in `sw.js` when any of them changes.
Scripts (`*.js`) are network-first like the page, so a deploy never pairs a new
`index.html` with an old `sound.js`.

## Sound

`sound.js` is the root build's `// ---------- Sound ----------` section — the
synthesis, the voices, `FLIGHT`, `RELOADS`, the level — moved into its own file,
which this build can do because the relay serves real files. It publishes
`window.BarrageSound` and knows nothing about the game. **Keep it in step with
the root copy**: a sound retuned in one belongs in both.

The page loads it before the game script, and `tests/harness.mjs` runs it in the
vm first for the same reason. What needs the game stays in `index.html` under
`// ---------- Sound ----------`: `updateSoundLoops()` in the frame loop,
`secondsToImpact()`, the slider wiring, and `screenX01()`. That last one is the
one real difference from the root build: sounds pan by where things are **on
screen**, through the camera, not by world position — zoomed in on the left of
the field, a blast at its centre is heard to your right.

If `sound.js` fails to load, the page swaps in silent no-ops and hides the
slider rather than dying on the first shot. The SFX slider and the language
toggle share the settings panel's last row.

## Themes

This build has more `THEMES` than the root one, and a THEME select in Settings
(`#theme-select`, stored as `barrage.theme`). `random` — the default — rolls a
different environment each round, as before; a named theme is used every
round. The option values are the English theme names, so adding a theme means
an entry in `THEMES`, an `<option>` in the same position, and a Turkish name in
`STRINGS.tr`. A theme may set `shape: 'dunes'` (Sandstorm does) to get
`generateDuneShape()` — smooth crests with one-sided slip faces — or
`shape: 'craters'` (Lunar Base) for `generateCraterShape()`, rimmed bowls
pressed into midpoint plains; anything else is plain midpoint displacement.
`planet: true` draws Earth in a starry sky (`drawEarth()`). `craft: 'ship'`
(Lunar Base) makes the target overhead a spaceship instead of a helicopter:
`drawShipBody()` in place of the rotored body, and `Sound.thruster` — an ion
exhaust over a drive hum — in place of `Sound.rotor`'s chop, since there is no
air to beat against. It is drawing and sound only, checked by `isShipTheme()`;
the craft is the same `heli` to the simulation, same size, same hit box, same
routes, so nothing about it travels in a message. `updateSoundLoops()` calls
both voices every frame with the theme deciding which one is on, so switching
themes stops the other one by the rule that stops either. Theme looks never
touch physics — the moon has the same gravity as everywhere else, since a
per-theme gravity would have to travel in the snapshot. In a match the theme travels in the snapshot, so it is the
preference of whoever deals the round (the host) that everyone sees; picking
one mid-match waits for the next round rather than repainting one screen.

## The jet

Jet Strike is a weapon only this build has. Picking it (`pickWeapon('jet')`,
or the hidden select) is `summonJet()`: a jet comes in from off one edge, and
the round is spent there and then — a pass that ends with its bombs still aboard
is wasted, and the turn stays with the player. It flies the way the tank's
barrel points (`jetFromLeft()`), so aiming left or right before picking it
chooses the side it comes in from; straight up, it heads across the wider
stretch of field from the tank. While it is inbound the weapon
choice is locked, the aim preview and the slingshot are off, the banner says
FIRE TO DROP, and the camera follows the jet. FIRE drops a stick of
`JET.bombs` from wherever it is, one every `JET.bombGapSteps` fixed steps; each
bomb leaves with the jet's velocity and no downward throw, then falls under
gravity and wind like any shell. FIRE does nothing until the jet is over the
field.

It is built the way the helicopter is. Its route — `t0`, `fromLeft`, `speed`,
`y` — is fixed when it is called in and announced once in a `jet` message
(with the seat's ammo), so every screen places it from the match clock
(`jetRouteAt`) and a shot meets it at the shot's own time (`jetFlyTo(simClock)`
in `simStep`). It crosses in 5.5–6.5s (the helicopter takes 9–14) and never
turns back: past the far edge the route is over. It stays up after its drop, so
`turn`, its `result` and every snapshot carry it, and the next seat can still
shoot it. `firstContact()` takes a `craft` argument because a bomb must not hit
the jet it fell from. A shot-down jet keeps most of its forward speed
(`JET.drag`), holds the turn in `EXPLODING` like a helicopter wreck, and lands
through `heliCrash()`, so it crushes a tank it comes down on. One jet at a time;
the CPU never calls one in.

It looks and sounds like an F-22. `drawJet()` draws the side profile in units of
the jet's length (chined nose, gold-tinted canopy, caret intake, twin canted
fins, flat nozzle with an afterburner), so it stays inside `jetHitBy()`'s box.
`Sound.jet` in `sound.js` is tuned against a recording of a real F-22 pass:
coming in it is bright and led by a turbine whine near 3 kHz, going away it is
a dark exhaust roar with the whine Doppler-dropped to near 1 kHz, and it is
loudest a little after it passes. It is a brown-noise roar and a white-noise
rush (both lowpassed, which together come out close to the recording's flat
spread), the whine, and a little afterburner crackle near the peak. The game
passes only where the jet is on screen and its direction; `jetPass()` turns
that into `approach` (which way through the pass) and `near` (the loudness).
Every number is in `JET_VOICE`, pairs being [coming in, gone by]. At its
loudest it sits just above a shell's whistle.

The jet and the helicopter share the sky. A bomb can hit the helicopter (it
passes `craft: 'heli'`, so only its own jet is ignored), and the two aircraft
can fly into each other. That needs no message either: both routes are fixed,
so `jetMeetsHeliAt()` works out the first moment on a `SIM_DT` grid that their
hit boxes overlap, and `jetHeliCollide(T)` — called from `simStep` inside a
shot and from `step` between shots — brings both down from where the routes had
them at that moment. Either wreck crushes a tank it lands on. The jet cruises
from the helicopter's band to well above it, so a pass with a helicopter up
meets it about a third of the time.

The guided missile hunts either one. When its motor lights it locks onto
whichever aircraft in flight is nearer to it (`nearestCraft()`, ties to the
helicopter) — `p.chase` is `'heli'`, `'jet'` or `null` — and `chaseTarget()`
and the proximity fuze follow that one only. Locked once, as before: if its
target is shot down or leaves mid-burn it drops back into its dive rather than
switching to the other.

## Reactions

Eight fixed emoji — 👏 😡 😂 😱 😈 🙏 💀 🤝, in `EMOTES` — that a player sends
over their own tank. Everything is in `// ---------- Reactions ----------`.
Only this build has them. Emoji 1–3 era characters only, so they render on
old Android too.

- **Who can react** is `canReact()`: the REACTIONS setting (`#reactions-select`,
  stored as `barrage.reactions`) is on and this screen has a seat
  (`youSeat()`: the dealt seat in a match, player 1 against the CPU). All human
  on one screen there is nobody to react to, so the button is hidden.
- **Sending**: the 🙂 button beside the online status (`#net-row`, next to
  PLAY WITH OTHERS or the room code) opens a tray of eight in two rows of four,
  narrow enough for the side rails; E opens it from the keyboard and 1–8 pick. It is
  kept off the battlefield on purpose. The tray is `position: fixed` and placed
  by `placeTray()` from the button's own position, on whichever side has more
  room — above it on a phone, below it in the desktop rail, where an upward
  tray would cover the scores — and always on screen, so no layout has to
  make room for it. In the two-rail landscape layout the right rail is full,
  so `placeNetGroup()` moves the whole `#net-group` — status and button — into
  the left rail's `#info-row`, above the clock and SETTINGS, and back again
  when the layout changes (two media queries, listened to). It also sets
  `.two-rails` on the root, which the right rail's own layout hangs off: the
  weapons three to a row with the jet pinned to the end of the first row —
  last in the list it sat right over FIRE — a button alone on the last row
  in its middle (`markLoneWeapon()`, since spent weapons leave the row), and
  FIRE at the rail's foot with a clear gap above it. Some of the height spare
  above FIRE also goes between the angle and power arrows and their sliders,
  and between the two groups (up to 12px and 10px, scaled with the screen's
  height, so the shortest phones keep the tight layout). A tap anywhere else
  closes it. `sendEmote(e)` shows the bubble here at once. Nothing is ever
  suggested or offered after a shot: reacting is only ever the player's idea.
- **The wire**: an `emote` message carries `e`, an **index** into `EMOTES`,
  and `turn`. No text ever travels, so there is nothing to moderate or
  translate, and a receiver ignores anything that is not 0–7. The seat is the
  sender's own, looked up from the relay's `from` — a seat named in the message
  is not believed. It skips the inbox: nothing on the board changes.
  Old clients ignore a kind they do not know, so no `PROTOCOL` bump.
- **Rate**: three sends in any five seconds (`SEND_BURST`, `SEND_WINDOW_MS`),
  with the button greyed while it waits. This matters beyond manners: the relay
  answers more than 40 messages a second with `RATE`, and the game treats that
  as a lost connection. Receivers also drop more than `RECV_BURST` per seat in
  the same window, so a modified client cannot bury anyone's screen.
- **No spoilers**: a reaction sent from a later `turn` than the one on screen
  arrives while this screen is still replaying the shot it is about. It waits
  in `emoteHold` and is shown when `finishShot()` lands it. One sent mid-flight
  is about the shot everyone is watching and shows at once.
- **Drawing**: a bubble over the tank in the sender's colour (`drawEmotes()`,
  CSS pixels like the wind gauge and YOU, stacked above YOU when that is up).
  They go on a canvas of their own, `#emote-layer`, sized with the game
  canvas in `resize()` and stacked above the round-over overlay — on the game
  canvas the overlay hid them, just when GG is said. Three per seat at most,
  gone after `EMOTE_SHOW_MS`; a copy on the player's card; and `Sound.pop`,
  panned to the tank. Dead tanks' players can still
  react — they are often the most talkative.
- **The CPU reacts**, against the CPU only (`cpuReact()`), to what a shot did.
  Every screen plays every shot and lands on the same board, so it works that
  out by itself: `watchShot()` in `beginShot()` notes the tanks,
  `watchBlast()` in `spawnExplosionFx()` the blasts, `watchDowned()` a
  helicopter or jet shot down, and `shotLanded()` in `finishShot()` hands them
  to `classifyShot()` (pure) — hits, kills, a self-hit, a near miss
  (`NEAR_MISS`), a wild one (`WILD_MISS`), the round over. It reacts with 💀
  destroyed, 😈 after hitting you, 😱 when hit lightly, 😡 most of the time
  (`CPU_EMOTE_ODDS.mad`) when a hit takes `CPU_BIG_HIT` (25) or more off it —
  that one ignores the gap — and 😂 at a wild miss. At the
  end of a round a CPU that won laughs (😂) as often as it says 🤝, and one
  that lost is mostly 😡 or 💀, now and then 🤝 — the CPU the last shot
  finished off, if one was. It may answer your 😈, 👏 or 🤝 (`cpuAnswer()`). One per shot at most, never within
  `CPU_EMOTE_GAP_MS`, odds in `CPU_EMOTE_ODDS`, half a second or so after the
  fact, and a new round cancels one on its way. Its dice are `reactRandom`, not
  `Math.random`, so reacting never shifts the AI's aim; the harness hands every
  test a CPU that never reacts unless it sets `setReactRandom()`.
- **Muting**: tap a player's card to hide their reactions on this screen only
  (🔇 on the card). Online the mute is keyed by the seat's token, so it
  survives a rematch and a reconnect; against the CPU by seat.

## Feeling a hit

When **your own** tank is hit (`youSeat()`: your seat in a match, player 1
against the CPU; nobody when everyone shares one screen) the phone buzzes —
30/60/110 ms by the size of the hit, a double thump when destroyed
(`hitPattern`) — and the battlefield shakes for `SHAKE_MS`, up to 10 CSS px,
fading. `feelHits()` runs once a frame and watches that tank's health, rather
than hooking every kind of damage (shells, bomblets, a wreck, a board from the
network), so nothing is missed and a new board or seat is never mistaken for a
hit. The buzz is `navigator.vibrate` (Android has it; no web page can buzz an
iPhone); the shake is an offset in `worldTransform()` only — a sway from sines,
never `Math.random` — so the UI, the pointer mapping and the simulation are
untouched. SHAKE in Settings (`barrage.shake`) turns off both, and the
slingshot's tick (`buzz`), and the shake also stays off under
`prefers-reduced-motion`.

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

- One finger drags, two fingers pinch and drag, the wheel zooms about the
  cursor, and three buttons over the playfield do the same for anyone not on a
  touch screen. Pointer events cover all three input kinds in one path, and the
  canvas carries `touch-action: none` so the browser does not scroll the page
  out from under a gesture.
- The canvas is shared with slingshot aiming, which is the root build's and
  works the same here: press the battlefield, pull back, let go to fire. On a
  seat you are playing the first finger is therefore a pull, not a drag, so
  panning there is two fingers (or the zoom buttons, or the wheel). On a seat
  you are not — a CPU's, another player's, or any moment that is not `AIMING` —
  one finger drags the view as before. A second finger landing mid-pull hands
  the gesture to the camera and puts the aim back.
- The pull itself is measured in **CSS pixels**, like the on-canvas wind gauge
  and unlike everything else on the battlefield: it is a gesture on a screen,
  so the same finger travel is the same shot at any zoom. `drawAimDrag()` is
  drawn under `screenTransform()` for the same reason.
- `camFollow()` runs each frame: zoomed in, it keeps the shell in view while
  one is in the air, and whoever is aiming between turns — but only as far as
  that takes. The target has to stay `CAM_MARGIN` of the view inside every
  edge, now and `CAM_LEAD` seconds ahead at its speed (never below the
  ground), so a shot whose whole flight fits on screen never moves the camera
  and a turn passing to a tank already in view does not either. It never
  changes the zoom. Without it zoom would be useless: firing would lose the
  shell at once.
- **A new board shows the whole battlefield** (`camNewBoard()`): a restart, a
  rematch on every screen, LEAVE back to a local game.
- **An aircraft zooms the view out.** A helicopter or a jet in the sky eases
  the view out to the whole field so it can be seen wherever you were
  looking (`camWatchSky()`), and back to the view you had once the sky is
  clear — or to your own turn view, if your turn came meanwhile
  (`camTurnStarted` waits, `skyHold()`). Zoom or pan while it is up and the
  camera is yours: nothing is undone when it goes.
- A deliberate pan sets `camPanned` and owns the camera until the turn changes,
  so following never yanks the view away from someone looking on purpose.
- **Your own view comes back on your turn.** Zoomed in, following the shell
  and then the other seats used to leave you, on your next turn, centred on
  your own tank rather than on the view you had framed to aim. The view is
  saved when a person at this screen fires (`camSaveView`, per seat, so
  players sharing a screen keep their own) and eased back to when their turn
  starts (`camTurnStarted` → `camEaseBack`, from `camFollow`): the zoom, and
  the position too if they had panned it themselves — otherwise following
  their tank is the view, as it was. Any zoom or pan while it eases back
  cancels it, and a new round forgets the saved views.

### Tank size

The root build draws a tank at a fixed 26px on any screen; here it would come
out ~10px on a portrait phone. So tanks, shells and the aim preview are drawn
at no less than `SPRITE_MIN_PX` CSS px per world unit (`spriteBoost()`, up to
`SPRITE_MAX_BOOST`), which fades to 1 on a desktop or once zoomed in. TANK SIZE
in Settings (`#size-select`, stored as `barrage.tankSize`) picks `large` — this,
the default — or `actual`, which turns it off. `resize()` hides the option
wherever the fitted world is already at or above the floor, since there the
two look the same (zoom only draws larger, so fitted is the worst case); a
desktop window narrowed to phone size gets it back. Like the camera it is drawing
only: `TANK_W`/`TANK_H` stay the collision box and nothing travels in a match.

A tank grown about its ground point holds its barrel higher and longer than the
real one, and shots still leave the real muzzle. `muzzleShift()` moves the start
of a shot sideways onto the drawn barrel's line and eases it off over
`MUZZLE_BLEND` units — sideways only, since any correction along the path bends
it visibly — and `barrelCover()` keeps shells, trails and the preview hidden
until they clear the drawn muzzle. The scaling is applied around `drawTank()`
in `render()`, not inside it, because `tools/icons.mjs` lifts `drawTank` out.

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
| `time` — a clock sample `{c}`, joined or not | `time` — `{c, s}`: the sample back, beside the relay's clock |
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

**It idles down on its own, and the platform's autostop is off.** Fly once
suspended a machine mid-match; more fundamentally, the platform cannot see that
a room is being *held* for a player who might come back, and stopping then
destroys it. So the relay decides: `IDLE_EXIT_MS` (5 minutes) with no sockets
and no rooms at all, and it exits; `auto_start_machines` brings it back on the
next request, in about a second. `ROOM_GRACE_MS` and `SWEEP_MS` are tunable the
same way. Note a machine stop — or an ordinary redeploy — takes every room with
it, since they live in memory.

**It runs as exactly one machine.** Rooms are an in-memory `Map`, so a room
exists only on the process that created it. Deployed with Fly's default of two
machines, joins round-robin and about half get `NO_ROOM` from a machine that
never heard of the room — the symptom is a lobby that works intermittently.
`fly.toml` pins `max_machines_running = 1` and CI deploys with `--ha=false`.
Scaling out means moving rooms out of process memory first, or pinning each
room to a machine with `fly-replay`.

## The client side

`// ---------- Online ----------` in `index.html`, with the shot machinery under
`// ---------- Shots: resolved once, played everywhere ----------`.

**A shot is resolved once and played everywhere.** On the client that drives
the seat, `fire()` first runs the whole shot to the end on a copy of the world
(`resolveShot()`: `saveWorld`, fixed steps, `advanceTurn`, `restoreWorld`) —
flight, blasts, craters, damage, a helicopter brought down and where its wreck
lands, the turn handed on and the new wind. Then one message goes out:

- **`turn`** — `{seat, angle, power, weapon, ai, turn, at, seed, wind, heli, jet, result}`.
  `result` is the snapshot the shot leaves behind. Every screen, the shooter's
  too, replays the shot from the inputs (`beginShot()`) and takes `result` as
  the board when it lands (`finishShot()`).

Before this, every screen simulated a shot by its own frame times and moved the
turn on when *its* animation ended, while the shooter's `sync` arrived whenever
it arrived. Screens drifted a few units apart and snapped back at each turn, and
whenever "my animation ended" and "their result arrived" came in a different
order on different screens, an old result undid a newer crater, or two screens
both worked out a helicopter crash. Now the answer is known before anyone
watches, and nothing about the outcome depends on which screen animates fastest.

What makes a replay land exactly on `result` (there are tests for each):

- **Fixed steps.** A shot runs `simStep(SIM_DT)` in fixed steps timed by the
  match clock (see below); only sparks, smoke, sound and the camera use the
  frame's own `dt`. A 30fps laptop and a 144Hz phone do the same arithmetic
  `resolveShot()` did.
- **A seed per shot.** Chance that changes the outcome — cluster scatter —
  draws from `simRandom`, seeded from `turn.seed`. Anything cosmetic stays on
  `Math.random`.
- **The same starting world.** The message carries the wind, the helicopter's
  route and the moment it was fired (`at`); terrain and tanks are the previous
  `result`.
- **Nothing lands on a replay in progress.** `turn`, `heli`, `jet`, `timeout`
  and `sync` go through `netReceive()`: applied in the order sent, and only when no
  shot is playing (`activeShot`) — otherwise queued in `online.inbox` and
  drained by `finishShot()`. A screen a whole shot behind (one queued, another
  arrives) skips to the current shot's result rather than falling further back.
- **Quiet resolving.** Nothing is heard while `resolving` is non-zero, and
  nothing about the helicopter is announced mid-shot (`!inShot()`).

`sync` — a full snapshot — is left for turns no shot's result covers: a skip the
turn clock called (`netPublishNext`), a crash between turns (`netPublishState`).
Snapshots carry `turn` (`turnSeq`, the round's count of resolved turns), and
`netApplyState()` drops one older than the turn this client is on; `start`
always applies. A match resumed mid-shot is handed that shot's `result`, since
the arrival has nothing to replay it from.

**The helicopter flies a route on the match clock.** When it spawns, the seat
holding the turn fixes its whole route — `t0`, `fromLeft`, `speed`, and `ys`,
the altitude of every leg — and announces it (`heli`). Where it is at any time
`T` is then plain arithmetic (`heliRouteAt()`, `heliLeg()`, `heliLegAt()`):
leg 0 comes in from just off one edge, every later leg turns back just past
the edge and comes in over the one it left by. So:

- It is **drawn at `netNow()` on every screen, always** (`heliDrawPos()`) —
  between shots, during them, whatever time the shot on screen has reached. No
  message can move it, because every copy of a route gives the same answer at
  the same moment: nothing is rewound when a late shot starts, corrected when
  its result lands, or announced at a turnaround.
- **A shot meets it at the shot's own time.** Step `k` of a shot fired at
  `turn.at` happens at `simClock = at + k × SIM_DT`, and `simStep()` puts the
  helicopter where the route has it then (`heliFlyTo(simClock)`) before anything
  can hit it. The shooter's `resolveShot()` and every replay get the same answer.
- **When it leaves is decided at a turn change, not at an edge.** In
  `advanceTurn()`, once every living seat has had a turn with it up, `legsTotal`
  becomes the leg it is on plus one (two at least, `HELI_MAX_LEGS` at most). That
  is inside the result everyone takes, where an edge is reached by each screen at
  its own moment. Past its last leg the route is over and each screen drops it.
- **When the next one comes is a match-clock moment too** (`heliDue`), carried
  in `heli` and every snapshot. It keeps passing through shots, other seats'
  turns and CPU turns. It is brought in only by the client playing the current
  turn (`heliAuthority()`: the seat's own client, or whoever plays a CPU-held
  seat), and only between shots. Each round sets its own first one (`resetGame()`).
- A shot-down wreck leaves its route: it becomes `x, y, vy, spin, t` stepped by
  `moveHeli()` inside the shot, and holds the turn in `EXPLODING` until it lands,
  so every screen crashes it inside the shot and agrees on what it did.
  `heliIn()` ignores news of the one this screen last brought down (`heliDownId`).

**Shots play on the match clock too** (`step()`). A replay starts late by however
long the message took — most of a second across the world — so it catches up:
double speed at `SHOT_CATCHUP_FULL_S` (0.3s) behind or more, and never less than
35% faster until level, so 0.1–0.3s is made up in about half a second. More than
`SHOT_SKIP_S` (1s) behind and it runs straight to `SHOT_SKIP_TO_S` (0.5s) behind
first. It never runs ahead of the clock. The steps are the same whatever the
speed, so only how quickly a screen shows the shot changes, never how it ends.

**The clock** is the relay's: on joining a client sends three `time` samples and
keeps the offset from the fastest round trip (`netClockSample`), and does it
again every `CLOCK_RESYNC_MS` (a minute) for long matches. A jump of more than a
second — the first answer, which moves from the page's own clock to the relay's —
shifts what the page has already stamped with it (`netRebaseClock`). Clock error
between two screens is typically 10–30ms across the world: a helicopter a unit or
so apart on the two screens, and never a different outcome, since hits use the
route at the shot's own time.

`nextTurn()` captures `actor` before advancing, because by the time a turn with
no shot is published `currentPlayer` is already the *next* seat.

Other things worth knowing:

- `netRemoteSeat(i)` is the counterpart to `isAi(i)`: a seat somebody else
  drives locks the turn controls exactly like a CPU seat does.
- The host deals the seats and hands out the world in the `start` message, so
  nothing depends on the clients generating the same terrain.
- **The deal is random, and so is who fires first.** In join order the host
  was always player 1, on the left, and shot first every round. Now
  `netDealSeats()` shuffles everyone the room does not already remember into
  the free seats, and every round `resetGame()` rolls who opens
  (`firstSeat()`) and where each tank stands (`slotOrder()`, used by
  `placeTanks()`) — rematches included, because the seats stay put for a whole
  match: in seat order the same player held the left edge all match, and with
  three or more the same ones sat in the middle with an enemy either side. A
  tank keeps its seat's colour; only its slot moves. In a match only the host
  rolls (`dealRandom`); the result is in the `start`, so guests never roll
  their own. **Local games roll both too** — against the CPU the human was
  otherwise always first — which is a difference from the root build, where
  player 1 still opens from the left.
- **YOU marks your own tank** for the first few seconds of a round, since it
  may be anywhere (`drawYouMarker()`, in CSS pixels like the wind gauge, and
  pinned to the edge when the camera is zoomed in elsewhere). "Yours" is the
  dealt seat in a match and player 1 against the CPU; all human on one screen
  it is not shown. `resetGame()` raises it (`markYou()`), and so does a
  `start` that brings a new round or a new seat; someone else resuming into
  the same round does not. Drawing only.
- The test harness deals in seat order with seat 0 first — and re-deals the
  boot round that way — unless a test asks for `load({ randomDeal: true })`
  or scripts the dice with `setDealRandom()`.
- **The relay knows nobody.** It issues a fresh member id per connection and
  remembers nothing across one, so identity is the game's job: each client holds
  a per-room token in `sessionStorage` (surviving the reload a waking phone
  often amounts to), presents it in `ready`, and the `start` message carries the
  seat/token table. The token comes from `crypto.randomUUID()` where available:
  a seat claim must not rest on two clients never drawing the same
  `Math.random()`, which under the tests' seeded PRNG is exactly what they do —
  and what hid a seat-swapping bug until the harness gave each client its own
  identity. **Seats are locked to the players the match was dealt to.**
  An empty one is held for its owner and nobody else — a stranger with the code
  is told the room is full, because taking over a seat means inheriting someone
  else's damage, ammo and position. A player who never comes back has their seat
  played by the CPU after two missed turns, which is the existing turn-clock
  path; their chair is simply never reassigned.
- **Names ride with tokens.** The NAME field in the lobby (`barrage.name` in
  localStorage) goes out in `ready`; the host keeps them in `netNamesById`
  and deals `names` beside `tokens` in every `start`, so they survive a
  resume. `online.seatNames` is read by `playerName()` and the cards only
  while a match is on. Names come from other clients, so `cleanName()` runs
  on arrival too: control and bidi characters stripped, capped at
  `MAX_NAME_LEN` (10), and only ever written with `textContent`. The relay's
  own `join.name` is unused — it is per-connection, and names must follow
  the seat.
- **Seating happens on `ready`, not on `peer`**, because `ready` is what carries
  the token. A `ready` with no matching seat gets a `denied`, which also stops
  that client's reconnect attempts — it is not a match it can join.
- Losing the token (cleared storage, a different browser) means losing the seat:
  it stays empty and the CPU plays it. That is the cost of locking seats, and
  the alternative is letting strangers inherit tanks.
- `netDealSeats()` keeps anyone the room remembers in the seat they had. Dealing
  purely in join order meant that if everyone dropped and reconnected in a
  different order, players swapped tanks and colours for no visible reason.
- `online.vacancies` is a list. It was a single seat, which orphaned the earlier
  one whenever two players were away at once — nobody could fill it and its tank
  sat there played by nothing.
- **Table size is the host's PLAYERS picker.** The room waits until that many
  players are present before dealing — the lobby counts up, `code AB12 — 3/4` —
  and anyone left over when it fills is told rather than parked in a lobby that
  never starts. "Present" means they have sent their `ready`
  (`netReadyIds()`), not just that their socket opened: a player dealt in
  between had no token on record, and was refused as a stranger when their
  `ready` arrived. During a match the roster controls lock and the opponents select
  reads Online, because the seats were dealt when it began.
- **Every turn has a minute.** One miss is simply skipped — being away from the
  keyboard for a minute is not a crime. A second miss in a row hands the seat to
  the CPU, which plays *that* turn rather than letting another lapse, and the
  tank stays in the game. Taking a turn at any point clears the count and hands
  the seat back; a CPU-played turn is marked `ai: true` so it is not mistaken
  for the player returning. A stand-in always plays at `TURN_AI_LEVEL`
  (medium), not at the client's own difficulty setting — that control is hidden
  during a match, so its value is only whatever that player last chose locally,
  and a substitute's strength would otherwise depend on whose browser stood in.
- **One stand-in per seat, and the player outranks it.** The CPU plays a seat on
  the client covering it (`netActsForSeat`), never on the seat's own client —
  that is where its player comes back, and a CPU firing there too sent two shots
  for one turn (the seat's own client stands in only if nobody else can). `ai`
  on a shot comes from who fired it (`fire({ byAi: true })` from
  `netPlayAiTurn`), not from whether the seat is CPU-held, so a player's click
  hands the seat back. If the player and the stand-in still fire the same turn,
  every screen takes the player's result (`netStandInLost`).
- `netActsForSeat()` decides which client speaks for a seat that cannot speak
  for itself — calling its deadline, and playing it once the CPU has it. It is
  the lowest living seat that is still a real player and is not this one:
  deterministic, so everyone agrees without asking, and a four-player game does
  not time the same seat out three times over. A client never calls time on
  itself, which is what makes it work when your own tab is frozen.
- **The relay holds an emptied room for five minutes.** It used to delete a room
  the instant its last member left, so a brief disconnection lost the code and
  the match with it. `/health` reports `rooms` in play and `held` separately.
- `netApplyState()` rebuilds the tanks when the snapshot's roster differs from
  the local one. Without that a client that joined a four-seat match keeps its
  own two tanks and quietly drops the rest of the board.
- `netSnapshot()` maps `Infinity` ammo to `-1`, because the standard shell's
  ammo is `Infinity` and JSON cannot carry it.
- `socketFactory` is overridable through the seam (`setSocketFactory`), which
  is how `tests/online.test.mjs` drives the whole protocol without a socket.
- The relay URL is the page's own origin, overridable with `?relay=ws://…`.
- **LEAVE** sits in the online pill beside the status (`netLeave()`). In a
  match it takes two taps, like RESTART ROUND, and says goodbye first: a
  `leaving` message, through the inbox like `timeout`, puts the seat in
  `aiSeats` on every screen so the CPU plays it at once instead of after two
  turns run out. The relay's `gone` follows and the seat is held as for any
  departure, so JOIN with the same code resumes it. The leaver drops the socket
  without waiting for it to report closing — the close handler ignores any
  socket that is no longer `online.ws` — and, if the board on screen was a
  match's (`online.dealt`), deals a local round on their own saved TANKS and
  OPPONENTS. Outside a match it is one tap: leaving a lobby, or clearing an
  error, leaves the local game on screen alone. A guest still in the lobby
  when the host goes re-sends its `ready`, because the new host deals only to
  players it has heard from.
- **Playing online has its own dialog** (`#online-modal`), apart from
  Settings: PLAY WITH OTHERS and the status pill open it, and Settings keeps
  only a PLAY ONLINE › button to it. Settings is the game's own setup and
  preferences — TANKS, OPPONENTS, CPU LEVEL, THEME, TANK SIZE, REACTIONS,
  ROUND, SOUND FX, LANGUAGE. Both dialogs share one look (`.modal`) and one
  mechanism (`openDialog` / `closeDialog`): one open at a time, Escape and the
  backdrop close it, focus goes back to what opened it, and while either is up
  the keyboard belongs to it (`dialogOpen()`), so SPACE never fires from
  behind one. A panel taller than the screen scrolls inside itself, and since
  phones hide scrollbars until you scroll, it shows a fade with a ▼ at its
  foot while there is more below (`.more`, from `refreshMoreHint()` on open,
  scroll, resize and when the online dialog changes). `refreshOnlineDialog()` makes it follow the connection: with none
  it is the way in — name, HOST with **PLAYERS**, CODE and JOIN — and otherwise
  the room: its code large, "share this code" and how many are here while the
  table fills (`tableFilling`; the pill keeps the code in its line), who is at
  the table once it is dealt (with YOU, CPU for a stand-in, LEFT for an empty
  chair), REJOIN and LEAVE. It closes itself when the table is dealt, and its
  LEAVE arms together with the pill's and closes it. The controls kept the ids
  they had in Settings.
- **PLAYERS is the table size** for a room you host (`#online-seats`, stored as
  `barrage.onlineSeats`), read by `netSeatCount()`. It used to be the host's
  TANKS, so hosting a four changed the local game too. A host still waiting
  can shrink it and the table deals if it is now full; once dealt it is fixed.
- **Restarting is the host's call.** Settings has RESTART ROUND (two taps: the
  first arms it for `RESTART_ARM_MS`). Offline it is `resetGame()`; in a match
  it is enabled only for the host, who deals the new board with
  `netRestartMatch()`, and guests see why it is greyed out. A guest's Play Again
  sends `rematch`, which queues in the inbox behind any shot still landing and
  is honoured only once the round is over. "Host" is whoever the relay says —
  the room's creator until they leave, then the next to have joined.
- **A restart holds empty seats.** It does not wait for a missing player: the
  `start` it deals carries `vacant` and `ai`, so every screen agrees the chair
  is empty and who the CPU is covering, and the player's token still resumes
  them — into the new board.
- **Every message carries `round`**, bumped by each deal (`netStartMatch`,
  `netRestartMatch`) and adopted from `start`. `netReceive()` drops board
  messages from any other round. A restart puts `turnSeq` back to zero, so
  without this a shot or `sync` sent just before it looked newer than the fresh
  board and landed on top of it.

## Known gaps

- **A departure does not stop the match.** Setting the status away from
  'playing' on `gone` deadlocked it: the turn clock only runs during a match, so
  the CPU could never take the empty seat and nothing could happen again. Play
  carries on, the status line says "opponent left", and the ordinary clock
  decides — one missed turn skipped, two and the CPU plays the seat. A
  disconnect is therefore not treated as leaving for good, which matters because
  minimising a browser on iOS closes the socket within seconds.
- **`showWind()` puts the wind on the HUD; `setWind()` rolls a new one and then
  shows it.** They used to be one function, so applying a snapshot re-rolled the
  wind into the HUD and *then* overwrote the variable — every screen displayed
  its own random number while the physics quietly used the right one. Every test
  compared `g.wind` and passed. When state and display can disagree, test the
  display.
- **Wind is rolled only by the client that resolves the turn.** It travels in the
  shot's `result`, so every screen shows it the moment the shot lands. Rolling it
  locally put a different figure on every screen for as long as a message took,
  and anyone who started aiming in that window aimed against a wind that existed
  nowhere.
- **A turn resolved on somebody else's behalf still has to be published.**
  `netPublishTurn()` is gated on driving the seat, so a skip called by the turn
  clock published nothing — the caller advanced and everyone else did not,
  leaving the two sides on different turns permanently. `netPublishNext` marks
  that case.
- **The end of a round has to be published like anything else.** The overlay is
  raised inside `endTurnCheckWin()`, which only runs on the client that resolved
  the shot; everyone else had `state` set to `GAMEOVER` and were shown nothing —
  a board that had stopped responding, with no idea who won. The snapshot
  carries `winner`, and `netApplyState()` raises and clears the overlay.
- **A dropped connection reconnects itself** (`netScheduleRejoin`), backing off
  over roughly the room's grace period, and the held seat means it resumes the
  live board rather than starting over. A deliberate `netLeave()` sets
  `online.left` so the player is not dragged back in, and `NO_ROOM`/`ROOM_FULL`
  stop the attempts — those are not coming back. This matters most on a phone,
  where switching apps for long enough has the OS tear the socket down.
- **A hidden tab still stops that player's game loop.** Browsers throttle
  `requestAnimationFrame` in a background tab, and the socket stays open, so
  nothing disconnects. It no longer holds the game up — the tab announces
  itself (`away`) on the way out, a missed turn is skipped, and a second miss
  hands the seat to the CPU — but that player cannot act until they return.
- **If everyone drops at once, the board is lost.** The relay holds rooms, not
  game state, so the code survives five minutes but the match only survives if
  at least one client stayed connected to hold it. One player dropping resumes
  exactly; everyone dropping deals a fresh game in the same room.
- **The rules are arbitrated between clients, not by the relay.** That is why
  `netActsForSeat()` exists: with no arbiter, exactly one client has to be
  chosen deterministically to call a timeout or play a stand-in seat. Moving
  turn arbitration into the relay would remove the tie-break and make the clock
  independent of any browser being awake — see below.

## Verified end to end

Against the deployed relay: two pages join a room, hold identical terrain and
wind, and after a shot agree on the crater, the wind roll and whose turn it is.
Four pages deal four distinct seats onto one battlefield. Frames have to be
pumped by hand in these checks (`requestAnimationFrame` neutered, `step()`
driven from a counter) because headless Chrome throttles whichever page is not
in front — the same throttling as the first gap above.

## Still to build

- **Two decisions deliberately deferred**, and probably one decision rather than
  two, since both mean the relay holding state it currently does not:
  - arbitrating turn timeouts server-side instead of electing a client;
  - keeping the last snapshot per room, so a match survives everyone dropping.
- **More than six players** would need `MAX_PLAYERS` raised in the game and
  `MAX_MEMBERS` in the relay (the two must match), plus a card, a colour and a
  reload sound per seat; nothing in the protocol assumes a count.
