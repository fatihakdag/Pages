# Barrage

A turn-based artillery game — two to four tanks lobbing shells over destructible
terrain, in the Scorched Earth tradition. Wind, six weapons, seven environments,
an AI with four difficulty levels, and a helicopter that occasionally flies over
and can be shot down.

Plays in English and Turkish, on desktop and phone.

## Play

Open `index.html` in a browser. That's it — no server, no build, no install.

← → aim · ↑ ↓ power · **space** fires. On touch, use the sliders and the arrow
buttons either side of them. Double-click the wind gauge to call in a
helicopter.

## Develop

The whole game is one self-contained `index.html`: markup, CSS and script in a
single file with no dependencies.

```bash
npm test          # 100 tests, no install needed
npm run shots     # screenshot every layout breakpoint
```

[AGENTS.md](AGENTS.md) is the guide to the codebase — a map of the file, the
core model, and the conventions to keep to.
