// Vine Link — level generation, difficulty curve, packs and loading.
//
// Generation (works on the lane graph, so rocks and bridges come for free):
//   1. Place rocks / bridges for the level's mechanics.
//   2. Partition every node into random winding paths (Warnsdorff-style walks that hug walls).
//   3. Repair: short paths (< 3 cells) and paths ending on a bridge are merged into a
//      neighbouring path's end, or spliced in by splitting a neighbour.
//   4. Merge paths whose ends touch until the target number of colors is reached.
//   5. Run the solver with limit 2. If a second solution exists, split the path where the two
//      solutions disagree (adds a pair, pins that region) and try again.
// Only path endpoints become seeds. Everything is driven by a seeded RNG, so level N is always
// identical — in node (tools/generate-levels.js) and in the browser fallback.

import { createLevel, SOIL, ROCK, BRIDGE } from './game.js';
import { solve } from './solver.js';

export const MAX_COLORS = 12;
export const LEVELS_PER_PACK = 30;

export const PACKS = [
  { id: 'seedling', name: 'Seedling', sizes: [5, 6], blurb: 'Gentle 5×5 and 6×6 gardens' },
  { id: 'sprout', name: 'Sprout', sizes: [7, 8], blurb: '7×7 and 8×8, rocks appear' },
  { id: 'blossom', name: 'Blossom', sizes: [9, 10], blurb: '9×9 and 10×10, bridges appear' },
  { id: 'grove', name: 'Grove', sizes: [11, 12], blurb: 'Sprawling 11×11 and 12×12 groves' },
];
export const TOTAL_LEVELS = PACKS.length * LEVELS_PER_PACK;

export function packOf(n) {
  return Math.min(PACKS.length - 1, Math.floor((n - 1) / LEVELS_PER_PACK));
}

// ---------------------------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------------------------

export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32: tiny, fast, good enough for puzzles. Returns floats in [0, 1). */
export function makeRng(seed) {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  return rng;
}

// ---------------------------------------------------------------------------------------------
// Difficulty curve
// ---------------------------------------------------------------------------------------------

// Average vine length per grid size; grows faster than the grid so later levels have fewer
// colors per cell and longer, more winding paths.
const BASE_LEN = { 5: 4.4, 6: 5.2, 7: 6.0, 8: 7.0, 9: 8.0, 10: 9.2, 11: 10.6, 12: 12.2 };

export function levelParams(n) {
  const pack = packOf(n);
  const i = (n - 1) % LEVELS_PER_PACK; // index within pack
  const half = LEVELS_PER_PACK / 2;
  const size = PACKS[pack].sizes[i < half ? 0 : 1];
  const t = (i % half) / (half - 1); // 0..1 progress within this size
  const avgLen = BASE_LEN[size] * (0.92 + 0.22 * t);

  let rocks = 0;
  let bridges = 0;
  if (pack >= 1 && i % 2 === 0) rocks = i === 0 ? 2 : 2 + ((n * 7) % Math.max(2, size - 3));
  if (pack >= 2 && i % 3 === 0) bridges = pack >= 3 && i % 2 === 0 ? 2 : 1;
  if (pack === 2 && i === 0) rocks = 0; // first bridge level: bridges only
  // The biggest boards need a few more colors, or a unique layout takes ages to find.
  const minColors = size >= 12 ? 11 : size >= 11 ? 10 : 3;
  return { n, size, avgLen, rocks, bridges, minColors, seed: `vine-link/level/${n}` };
}

// ---------------------------------------------------------------------------------------------
// Tutorial levels (hand-made, verified unique by the test-suite)
// ---------------------------------------------------------------------------------------------

// Level 1 is hand-made: five friendly L-shapes. Levels 2–3 are generated with short vines.
const TUTORIAL_ONE = ['A...A', 'B....', 'C....', 'D.D..', 'E.ECB'];
export const TUTORIAL_COUNT = 3;

function parseRows(rows) {
  const size = rows.length;
  const seeds = new Map();
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      if (!seeds.has(ch)) seeds.set(ch, []);
      seeds.get(ch).push(r * size + c);
    }),
  );
  const pairs = [...seeds.keys()].sort().map((k) => seeds.get(k));
  return { size, pairs, rocks: [], bridges: [] };
}

export function tutorialDef(n) {
  if (n === 1) {
    const def = parseRows(TUTORIAL_ONE);
    return { ...def, solution: solve(createLevel(def), { limit: 1 }).solution };
  }
  return generateLevel({ n, size: 5, avgLen: n === 2 ? 4.2 : 5, rocks: 0, bridges: 0, extraColors: 0, seed: `vine-link/tutorial/${n}` });
}

// ---------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------

function placeRocks(size, count, rng) {
  const kind = new Uint8Array(size * size);
  const cells = size * size;
  let placed = 0;
  for (let tries = 0; placed < count && tries < 400; tries++) {
    const cell = rng.int(cells);
    if (kind[cell] !== SOIL) continue;
    kind[cell] = ROCK;
    if (!soilConnected(kind, size)) {
      kind[cell] = SOIL;
      continue;
    }
    placed++;
    // sometimes grow a small boulder cluster
    if (placed < count && rng() < 0.45) {
      const r = Math.floor(cell / size), c = cell % size;
      const nbs = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(
        ([y, x]) => y >= 0 && x >= 0 && y < size && x < size,
      );
      const [y, x] = rng.pick(nbs);
      const n2 = y * size + x;
      if (kind[n2] === SOIL) {
        kind[n2] = ROCK;
        if (soilConnected(kind, size)) placed++;
        else kind[n2] = SOIL;
      }
    }
  }
  return kind;
}

function soilConnected(kind, size) {
  const cells = size * size;
  let start = -1, total = 0;
  for (let i = 0; i < cells; i++) if (kind[i] !== ROCK) { total++; if (start < 0) start = i; }
  if (start < 0) return false;
  const seen = new Uint8Array(cells);
  const st = [start];
  seen[start] = 1;
  let n = 1;
  while (st.length) {
    const x = st.pop();
    const r = Math.floor(x / size), c = x % size;
    const nbs = [];
    if (r > 0) nbs.push(x - size);
    if (r < size - 1) nbs.push(x + size);
    if (c > 0) nbs.push(x - 1);
    if (c < size - 1) nbs.push(x + 1);
    for (const y of nbs) if (!seen[y] && kind[y] !== ROCK) { seen[y] = 1; n++; st.push(y); }
  }
  return n === total;
}

function placeBridges(kind, size, count, rng) {
  const cand = [];
  for (let r = 1; r < size - 1; r++) {
    for (let c = 1; c < size - 1; c++) {
      const cell = r * size + c;
      const around = [cell, cell - 1, cell + 1, cell - size, cell + size];
      if (around.every((x) => kind[x] === SOIL)) cand.push(cell);
    }
  }
  rng.shuffle(cand);
  const out = [];
  for (const cell of cand) {
    if (out.length >= count) break;
    const r = Math.floor(cell / size), c = cell % size;
    // keep bridges apart so each one is readable
    if (out.some((b) => Math.abs(Math.floor(b / size) - r) + Math.abs((b % size) - c) < 3)) continue;
    if ([cell - 1, cell + 1, cell - size, cell + size].some((x) => kind[x] !== SOIL)) continue;
    kind[cell] = BRIDGE;
    out.push(cell);
  }
  return out;
}

/** Random cover of every lane node by vertex-disjoint paths. Returns arrays of nodes or null. */
function randomPartition(level, rng, avgLen) {
  const g = level.graph;
  const M = g.nodeCount;
  const cellCount = level.cellCount;
  const isBridgeNode = (v) => level.kind[v % cellCount] === BRIDGE;
  const used = new Uint8Array(M);
  const inPath = new Int32Array(M).fill(-1);
  for (let v = 0; v < M; v++) if (!g.active[v]) used[v] = 1;
  let free = g.activeCount;
  const freeDeg = (v) => {
    let d = 0;
    for (const u of g.adj[v]) if (!used[u]) d++;
    return d;
  };

  const paths = [];
  while (free > 0) {
    // start in the tightest spot (corners, pockets) — fewer leftovers
    let best = [], bestDeg = 99;
    for (let v = 0; v < M; v++) {
      if (used[v] || isBridgeNode(v)) continue;
      const d = freeDeg(v);
      if (d < bestDeg) { bestDeg = d; best = [v]; }
      else if (d === bestDeg) best.push(v);
    }
    if (!best.length) return null;
    const start = rng.pick(best);
    const p = [start];
    const pid = paths.length;
    inPath[start] = pid;
    used[start] = 1;
    free--;
    const want = Math.max(3, Math.round(avgLen * (0.55 + rng() * 0.95)));
    const extend = () => {
      for (;;) {
        const tail = p[p.length - 1];
        if (p.length >= want && !isBridgeNode(tail)) return;
        let opts = g.adj[tail].filter((u) => !used[u]);
        if (!opts.length) return;
        // A vine that brushes against itself almost always allows a shortcut (= a second
        // solution), so avoid it unless the vine is still too short to stop.
        const clean = opts.filter((u) => !g.adj[u].some((w) => w !== tail && inPath[w] === pid));
        if (clean.length) opts = clean;
        else if (p.length >= 3 && !isBridgeNode(tail)) return;
        let next;
        if (rng() < 0.78) {
          let md = 99, cands = [];
          for (const u of opts) {
            const d = freeDeg(u) - 1;
            if (d < md) { md = d; cands = [u]; } else if (d === md) cands.push(u);
          }
          next = rng.pick(cands);
        } else next = rng.pick(opts);
        p.push(next);
        used[next] = 1;
        inPath[next] = pid;
        free--;
      }
    };
    extend();
    if (p.length < want) {
      p.reverse();
      extend();
    }
    paths.push(p);
  }
  return paths;
}

function isBadPath(level, p) {
  const cc = level.cellCount;
  return p.length < 3 || level.kind[p[0] % cc] === BRIDGE || level.kind[p[p.length - 1] % cc] === BRIDGE;
}

/** Fix short paths and bridge-ended paths by merging / splicing into neighbours. */
function repairPaths(level, paths, rng) {
  const g = level.graph;
  const cc = level.cellCount;
  const bridgeNode = (v) => level.kind[v % cc] === BRIDGE;
  for (let iter = 0; iter < 400; iter++) {
    const owner = new Int32Array(g.nodeCount).fill(-1);
    paths.forEach((p, i) => p.forEach((v) => (owner[v] = i)));
    const bad = [];
    paths.forEach((p, i) => { if (isBadPath(level, p)) bad.push(i); });
    if (!bad.length) return paths;
    const si = rng.pick(bad);
    const s = paths[si];
    const ops = [];
    // for each end of s that needs help (any end if short; the bridge end otherwise)
    const ends = [];
    if (s.length < 3) ends.push(0, s.length - 1);
    else {
      if (bridgeNode(s[0])) ends.push(0);
      if (bridgeNode(s[s.length - 1])) ends.push(s.length - 1);
    }
    for (const ei of new Set(ends)) {
      const e = s[ei];
      const sOut = ei === 0 ? s.slice().reverse() : s.slice(); // ends with e
      for (const u of g.adj[e]) {
        const qi = owner[u];
        if (qi < 0 || qi === si) continue;
        const q = paths[qi];
        const j = q.indexOf(u);
        if (j === 0 || j === q.length - 1) {
          const qIn = j === 0 ? q : q.slice().reverse(); // starts with u
          ops.push({ remove: [si, qi], add: [sOut.concat(qIn)] });
        } else {
          // splice: s attaches to q at u, q's other piece becomes its own path
          ops.push({ remove: [si, qi], add: [sOut.concat(q.slice(0, j + 1).reverse()), q.slice(j + 1)] });
          ops.push({ remove: [si, qi], add: [sOut.concat(q.slice(j)), q.slice(0, j)] });
        }
      }
    }
    if (!ops.length) return null;
    // prefer ops that don't create new problems
    const good = ops.filter((op) => op.add.every((p) => !isBadPath(level, p)));
    const op = rng.pick(good.length ? good : ops);
    const rm = new Set(op.remove);
    paths = paths.filter((_, i) => !rm.has(i)).concat(op.add);
  }
  return null;
}

/** Would joining paths a and b at (ea → eb) make the vine run alongside itself? */
function touches(g, a, b, ea, eb) {
  const inB = new Set(b);
  for (const x of a) {
    for (const w of g.adj[x]) {
      if (inB.has(w) && !(x === ea && w === eb)) return true;
    }
  }
  return false;
}

/**
 * Reduce the number of vines toward `target` with a small local search:
 *   merge  — join two vines whose ends touch (only if the result doesn't brush itself);
 *   splice — when no clean merge exists, re-route one vine's end into a neighbour, handing the
 *            neighbour's tail over. Same vine count, new shape, often unlocks new merges.
 * If we're still above `hardCap` at the end, self-touching merges are allowed as a last resort.
 */
function mergeDown(level, paths, target, rng, hardCap = MAX_COLORS) {
  const g = level.graph;
  const cc = level.cellCount;
  const okEnd = (v) => level.kind[v % cc] !== BRIDGE;
  const join = (a, b) => a.concat(b);
  let iterations = 0;
  const maxIter = 60 + paths.length * 40;

  while (paths.length > target && iterations++ < maxIter) {
    const owner = new Int32Array(g.nodeCount).fill(-1);
    paths.forEach((p, i) => p.forEach((v) => (owner[v] = i)));
    const lax = iterations > maxIter - 20 && paths.length > hardCap;

    const merges = [];
    const splices = [];
    paths.forEach((p, i) => {
      for (const side of [0, 1]) {
        const e = side === 0 ? p[0] : p[p.length - 1];
        const pe = side === 1 ? p : p.slice().reverse(); // ends at e
        for (const u of g.adj[e]) {
          const j = owner[u];
          if (j < 0 || j === i) continue;
          const q = paths[j];
          const k = q.indexOf(u);
          if (k === 0 || k === q.length - 1) {
            if (j < i) continue; // each merge once
            const qu = k === 0 ? q : q.slice().reverse(); // starts at u
            if (lax || !touches(g, pe, qu, e, u)) merges.push([i, j, join(pe, qu)]);
          } else {
            // splice e→u: p takes one side of q, the other side stays as q
            const options = [
              [q.slice(k), q.slice(0, k)],
              [q.slice(0, k + 1).reverse(), q.slice(k + 1)],
            ];
            for (const [take, rest] of options) {
              if (rest.length < 3 || !okEnd(rest[0]) || !okEnd(rest[rest.length - 1])) continue;
              if (touches(g, pe, take, e, u)) continue;
              splices.push([i, j, join(pe, take), rest]);
            }
          }
        }
      }
    });

    if (merges.length) {
      // favour merging short vines so lengths stay balanced
      merges.sort((x, y) => x[2].length - y[2].length);
      const [i, j, merged] = merges[Math.floor(rng() * rng() * merges.length)];
      paths = paths.filter((_, k) => k !== i && k !== j).concat([merged]);
    } else if (splices.length) {
      const [i, j, grown, rest] = rng.pick(splices);
      paths = paths.filter((_, k) => k !== i && k !== j).concat([grown, rest]);
    } else break;
  }
  return paths;
}

function cellPaths(level, nodePaths) {
  return nodePaths.map((p) => p.map((v) => v % level.cellCount));
}

function samePath(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]) || a.every((x, i) => x === b[b.length - 1 - i]);
}

/**
 * Generate one level. Returns a definition { size, pairs, rocks, bridges, solution } or null if
 * this attempt failed (callers retry with the same RNG, which keeps things deterministic).
 */
function attempt(params, rng, budget) {
  const { size } = params;
  const kind = params.rocks ? placeRocks(size, params.rocks, rng) : new Uint8Array(size * size);
  const bridges = params.bridges ? placeBridges(kind, size, params.bridges, rng) : [];
  if (bridges.length < (params.bridges || 0)) return null;
  const rocks = [];
  kind.forEach((k, i) => { if (k === ROCK) rocks.push(i); });
  const base = createLevel({ size, pairs: [], rocks, bridges });

  let paths = randomPartition(base, rng, params.avgLen);
  if (!paths) return null;
  paths = repairPaths(base, paths, rng);
  if (!paths) return null;
  const target = Math.max(params.minColors ?? 3, Math.min(MAX_COLORS - 1, Math.round(base.graph.activeCount / params.avgLen)));
  const maxColors = Math.min(MAX_COLORS, target + (params.extraColors ?? 1));
  paths = mergeDown(base, paths, target, rng, maxColors);
  if (paths.length > maxColors) return null;
  for (let round = 0; round < 6; round++) {
    rng.shuffle(paths);
    const cells = cellPaths(base, paths);
    const def = { size, pairs: cells.map((p) => [p[0], p[p.length - 1]]), rocks, bridges };
    const lvl = createLevel(def);
    const res = solve(lvl, { limit: 2, maxSteps: budget });
    if (res.aborted) return null;
    if (res.count === 1) return { ...def, solution: res.solution };
    // Two solutions: split one of our paths where the other solution disagrees.
    if (paths.length >= maxColors) return null;
    const other = res.solutions.find((s) => !s.every((p, c) => samePath(p, cells[c])));
    if (!other) return null;
    const diff = [];
    cells.forEach((p, c) => { if (!samePath(p, other[c])) diff.push(c); });
    let split = false;
    for (const c of rng.shuffle(diff)) {
      const p = paths[c];
      if (p.length < 6) continue;
      // first index where the two solutions part ways
      const q = other[c][0] === cells[c][0] ? other[c] : other[c].slice().reverse();
      let d = 0;
      while (d < p.length && cells[c][d] === q[d]) d++;
      const choices = [];
      for (let k = 2; k <= p.length - 4; k++) {
        const a = p[k], b = p[k + 1];
        if (base.kind[a % base.cellCount] === BRIDGE || base.kind[b % base.cellCount] === BRIDGE) continue;
        choices.push(k);
      }
      if (!choices.length) continue;
      choices.sort((x, y) => Math.abs(x - d) - Math.abs(y - d));
      const k = choices[Math.min(choices.length - 1, rng.int(2))];
      paths = paths.filter((_, i) => i !== c).concat([p.slice(0, k + 1), p.slice(k + 1)]);
      split = true;
      break;
    }
    if (!split) return null;
  }
  return null;
}

export function generateLevel(params, { budget = 400_000, maxAttempts = 400 } = {}) {
  const rng = makeRng(params.seed);
  for (let i = 0; i < maxAttempts; i++) {
    const def = attempt(params, rng, budget);
    if (def) return { ...def, meta: { attempts: i + 1 } };
  }
  throw new Error(`Could not generate level ${params.seed}`);
}

// Puzzles that need a huge search are almost never unique; giving up early and trying a fresh
// layout is far cheaper on big boards.
const BUDGET = { 5: 400_000, 6: 400_000, 7: 400_000, 8: 400_000, 9: 300_000, 10: 200_000, 11: 150_000, 12: 150_000 };

export function campaignDef(n) {
  if (n >= 1 && n <= TUTORIAL_COUNT) return tutorialDef(n);
  const params = levelParams(n);
  return generateLevel(params, { budget: BUDGET[params.size], maxAttempts: 3000 });
}

// ---------------------------------------------------------------------------------------------
// Daily Garden
// ---------------------------------------------------------------------------------------------

export function dateKey(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The daily puzzle: Monday is gentle, the weekend is a little bigger and has a bridge. */
export function dailyParams(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0 Sun
  const sizes = [8, 6, 7, 7, 8, 8, 8];
  const size = sizes[dow];
  const rng = makeRng(`vine-link/daily-params/${key}`);
  return {
    n: 0,
    size,
    avgLen: BASE_LEN[size] * (1 + rng() * 0.12),
    rocks: dow === 2 || dow === 4 || dow === 6 ? 2 + rng.int(3) : 0,
    bridges: dow === 0 || dow === 6 ? 1 : 0,
    seed: `vine-link/daily/${key}`,
  };
}

export function dailyDef(key = dateKey()) {
  return { ...generateLevel(dailyParams(key), { budget: 200_000 }), daily: key };
}

// ---------------------------------------------------------------------------------------------
// Compact JSON (levels.json) and loading
// ---------------------------------------------------------------------------------------------

export function toCompact(def) {
  const o = { n: def.size, p: def.pairs };
  if (def.rocks?.length) o.r = def.rocks;
  if (def.bridges?.length) o.b = def.bridges;
  if (def.solution) o.s = def.solution;
  return o;
}

export function fromCompact(o) {
  return { size: o.n, pairs: o.p, rocks: o.r || [], bridges: o.b || [], solution: o.s || null };
}

let campaign = null;
let campaignPromise = null;

/** Load levels.json once. Falls back to generating in-browser (same seeds → same levels). */
export function loadCampaign(url = 'levels.json') {
  if (campaignPromise) return campaignPromise;
  campaignPromise = fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((data) => {
      // A missing entry just falls back to in-browser generation for that one level.
      campaign = data.levels.map((o) => (o && Array.isArray(o.p) ? fromCompact(o) : null));
      return campaign;
    })
    .catch((err) => {
      console.warn('[Vine Link] levels.json unavailable, generating levels on the fly', err);
      campaign = null;
      return null;
    });
  return campaignPromise;
}

const generatedCache = new Map();

export function getLevelDef(n) {
  if (campaign && campaign[n - 1]) return campaign[n - 1];
  if (!generatedCache.has(n)) generatedCache.set(n, campaignDef(n));
  return generatedCache.get(n);
}

export function buildLevel(def, id) {
  const lvl = createLevel({ ...def, id });
  if (!lvl.solution) lvl.solution = solve(lvl, { limit: 1 }).solution;
  return lvl;
}
