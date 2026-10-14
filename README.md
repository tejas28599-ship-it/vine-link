# Vine Link

A path-connecting puzzle for your phone. Draw pipes to link matching colored dots, without
crossing, until every cell on the board is filled.

<p align="center">
  <img src="docs/screenshot-placeholder.svg" alt="Vine Link screenshot (placeholder)" width="270">
</p>

**Play it:** https://tejas28599-ship-it.github.io/vine-link/

Plain HTML, CSS and vanilla JavaScript with no frameworks, dependencies or build step. It installs as a PWA and works offline.

## How to play

1. **Drag from a dot** to the other dot of the same color to draw a pipe between them.
2. Pipes move up, down, left and right. They **can't cross or overlap**. Draw over another pipe
   and it gets cut back.
3. Drag back along a pipe to shorten it. **Tap a dot** to clear its pipe.
4. The level is solved when **every pair is connected and every cell is filled**.

### Along the way

| Pack     | Grid          | New idea |
|----------|---------------|----------|
| Starter  | 5×5 – 6×6     | Levels 1–3 are a gentle tutorial |
| Classic  | 7×7 – 8×8     | **Blocked cells (×)**: pipes must go around them |
| Advanced | 9×9 – 10×10   | **Bridges**: one pipe crosses left–right, another top–bottom |
| Expert   | 11×11 – 12×12 | Long, winding pipes |

- **Hint (?):** draws one correct pipe for you, 3 per level.
- **Perfect star:** solve a level drawing each pair exactly once.
- **Best:** your lowest move count for each level.
- **Daily Puzzle:** a new puzzle every day, seeded by the date, so everyone gets the same one.
- **Colorblind mode:** every color gets its own symbol on its dots.
- Previous / next level buttons, undo, restart.
- Every level has **exactly one solution** (checked by the solver when it's generated and again in the test suite).

## Run it locally

ES modules and the service worker need a real web server (opening `index.html` as a file won't
work). Any static server is fine:

```bash
node tools/serve.js
```

Then open http://localhost:8080. Alternatives: `python3 -m http.server 8080` or `npx serve`.

To test on your phone, serve on your LAN (e.g. `python3 -m http.server 8080 --bind 0.0.0.0`) and
open `http://<your-computer-ip>:8080`. Add `?debug` to the URL to expose `window.__vine` in the console.

### Tests

Needs Node 18+ and nothing else:

```bash
npm test
```

The suites cover the rules engine (cutting, shrinking, bridges, undo, hints, save/restore),
storage, gap-free swipe traversal, and **all 120 levels** (unique solution, solver speed,
difficulty curve, deterministic generation, Daily Puzzle).

### Regenerating levels

Levels come from a seeded generator, so level N is always the same. They are pre-generated into
`levels.json` (big grids take a while to prove unique):

```bash
npm run generate            # all 120 levels, uses every CPU core
node tools/generate-levels.js 91 120   # just a range
```

If `levels.json` can't be loaded, the game generates the same levels in the browser.

## Project layout

```
index.html          screens, HUD, dialogs
css/style.css       theme + responsive layout (safe areas, 360px phones → tablets)
js/game.js          pure rules: lane graph, pipes, cutting, undo, win check, hints
js/solver.js        backtracking solver (counts solutions → uniqueness)
js/levels.js        seeded RNG, generator, packs, difficulty curve, Daily Puzzle
js/render.js        canvas renderer: white board, outlined pipes, glossy dots, tinted cells, confetti
js/input.js         pointer input, single-finger, supercover swipe traversal
js/audio.js         Web Audio synthesized sound effects
js/storage.js       localStorage (every access wrapped in try/catch)
js/app.js           screens + glue
sw.js, manifest.json  PWA (offline cache, install)
tools/              level generator, icon maker, tiny static server
tests/              node --test suites
docs/DESIGN.md      original design proposal (data model, palette, build order)
```

## Deploying

The repo is served by GitHub Pages straight from `main` (root). When you change cached files, bump
`VERSION` in `sw.js`. The service worker fetches network-first, so players get updates right
away and fall back to the cache when offline.
