# Vine Link — Design Proposal

A calm, mobile-first path-connecting puzzle. Plain HTML/CSS/vanilla JS (ES modules), no build
step, hostable on GitHub Pages.

## 1. Folder structure

```
vine-link/
├── index.html            # single page: home, level select, game screens + modals
├── manifest.json         # PWA manifest
├── sw.js                 # service worker (offline cache)
├── levels.json           # pre-generated campaign (120 levels, unique solutions)
├── package.json          # only for `npm test` / `npm run generate` (no runtime deps)
├── css/
│   └── style.css         # layout, theme tokens, screens, modals
├── js/
│   ├── game.js           # PURE rules: grid graph, vines, cutting, undo, win check, hints
│   ├── solver.js         # PURE backtracking solver (counts solutions, used for hints/uniqueness)
│   ├── levels.js         # seeded RNG, generator, packs, difficulty curve, level loading, daily
│   ├── palette.js        # flower colors, symbols, petal shapes, chime notes
│   ├── render.js         # canvas renderer: soil, grass, vines, flowers, magnifier, petals
│   ├── input.js          # pointer events → grid cells (supercover traversal, single pointer)
│   ├── audio.js          # Web Audio synthesized sound effects
│   ├── storage.js        # localStorage wrapper (try/catch everywhere)
│   └── app.js            # screens, HUD, wiring between modules
├── icons/                # SVG + PNG app icons
├── tools/
│   ├── generate-levels.js  # node script → levels.json
│   └── make-icons.js       # node script → PNG icons (tiny built-in PNG encoder)
├── tests/                # node --test suites
└── docs/DESIGN.md
```

## 2. Data model

Cells are integer indices `i = row * size + col`.

```js
// Level definition (levels.json, compact)
{ n: 7,                       // grid size N (5..12)
  p: [[a, b], ...],           // seed pairs; pair index === color index
  r: [cell, ...],             // rocks (blocked cells)
  b: [cell, ...],             // bridges (one horizontal + one vertical lane)
  s: [[cell, ...], ...] }     // stored unique solution (cache for hints)

// Runtime level (createLevel)
{ size, cellCount,
  kind: Uint8Array,           // 0 soil, 1 rock, 2 bridge
  seedColor: Int8Array,       // -1 or color of the seed on that cell
  pairs: [{a, b}],
  graph: { nodeCount, active, adj, activeCount } }
```

**Lane graph.** Every soil cell is one *node*. A bridge cell is two nodes: its horizontal lane
(node id = cell) and its vertical lane (node id = cellCount + cell). Horizontal neighbours link
through horizontal lanes and vertical neighbours through vertical lanes, so a vine through a
bridge is automatically straight. The solver and generator only see "cover all nodes with
vertex-disjoint paths between terminal pairs".

```js
// Game state (immutable; every action returns a new object)
{ vines: [[cell, ...], ...],  // per color; starts at one of its seeds, [] when empty
  moves, lastColor,           // a "move" = drawing a different color than the last one
  hintsUsed,
  history: [{ vines, lastColor }] }   // undo stack
```

A drag is `{ color, path, base }`: the preview is always recomputed from the state at drag
start, so vines cut mid-drag grow back if you pull away again.

## 3. Features in build order

1. Pure rules engine (`game.js`) + unit tests
2. Playable screen: canvas board, pointer input, HUD, win overlay, responsive layout
3. Solver + seeded generator, uniqueness filter, pre-generated `levels.json`, tutorial levels
4. Juice: growing wiggly vines with leaves, bloom/petal pop, glow pulse, retract, grass, win petals
5. Progression: home, packs, level select, save/restore, auto-advance, Perfect badge
6. Mechanics: rocks, bridges, watering-can hints, Daily Garden, first-time tutorials
7. Polish: Web Audio SFX, vibration, settings, colorblind symbols/petal shapes
8. PWA: manifest, icons, service worker, native-feel meta tags
9. QA pass and fixes
10. README, git, GitHub Pages

## 4. Flower palette (12)

The classic bright puzzle colors: fully saturated, with vines drawn in the pure color on dark soil
so every pair is easy to see. Colorblind mode adds a unique symbol on every seed and a unique
petal count/shape on every flower, so color is never the only cue.

| # | Name    | Hex       | Symbol   | Petals      |
|---|---------|-----------|----------|-------------|
| 0 | Red     | `#FF1A1A` | dot      | 5 round     |
| 1 | Green   | `#00D62B` | triangle | 3 pointed   |
| 2 | Blue    | `#2E6BFF` | star     | 8 thin      |
| 3 | Yellow  | `#FFF200` | plus     | 4 heart     |
| 4 | Orange  | `#FF9900` | diamond  | 6 round     |
| 5 | Cyan    | `#00FFFF` | drop     | 5 pointed   |
| 6 | Magenta | `#FF1FE6` | square   | 4 round     |
| 7 | Pink    | `#FF8FC8` | heart    | 6 heart     |
| 8 | Purple  | `#B44CFF` | ring     | 12 thin     |
| 9 | White   | `#FFFFFF` | hexagon  | 6 pointed   |
| 10| Gray    | `#C4C4C4` | moon     | 7 round     |
| 11| Lime    | `#A6FF1A` | bars     | 4 pointed   |
