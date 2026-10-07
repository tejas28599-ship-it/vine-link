import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLevel, isValidPath, getStats, applyHint, newGame, BRIDGE, MIN_SIZE, MAX_SIZE } from '../js/game.js';
import { solve } from '../js/solver.js';
import * as L from '../js/levels.js';
import { PALETTE } from '../js/palette.js';

const data = JSON.parse(readFileSync(new URL('../levels.json', import.meta.url), 'utf8'));
const defs = data.levels.map(L.fromCompact);

test('levels.json holds the whole campaign', () => {
  assert.equal(defs.length, L.TOTAL_LEVELS);
  assert.equal(L.TOTAL_LEVELS, 120);
});

test('every level has exactly ONE solution, found quickly', () => {
  let worst = { ms: 0 };
  for (const [i, def] of defs.entries()) {
    const n = i + 1;
    const lvl = createLevel(def);
    const t = performance.now();
    const res = solve(lvl, { limit: 2, maxSteps: 3_000_000 });
    const ms = performance.now() - t;
    assert.ok(!res.aborted, `level ${n}: solver gave up`);
    assert.equal(res.count, 1, `level ${n}: expected a unique solution, found ${res.count}`);
    if (ms > worst.ms) worst = { n, ms, steps: res.steps };
  }
  // Proving uniqueness (exploring the whole tree) stays well under a second even for 12×12.
  assert.ok(worst.ms < 2000, `slowest proof: level ${worst.n} took ${worst.ms.toFixed(0)}ms`);
  console.log(`  slowest uniqueness proof: level ${worst.n}, ${worst.ms.toFixed(0)}ms, ${worst.steps} steps`);
});

test('stored solutions are valid, fill the board and match the solver', () => {
  for (const [i, def] of defs.entries()) {
    const n = i + 1;
    const lvl = createLevel(def);
    assert.ok(def.solution, `level ${n} has a stored solution`);
    def.solution.forEach((p, c) => {
      assert.ok(isValidPath(lvl, c, p), `level ${n} color ${c}: invalid path`);
      assert.ok(p.length >= 3, `level ${n} color ${c}: path shorter than 3`);
    });
    const st = getStats(lvl, { vines: def.solution });
    assert.ok(st.solved, `level ${n}: stored solution doesn't solve the level`);
  }
});

test('difficulty curve: sizes, colors and mechanics per pack', () => {
  for (const [i, def] of defs.entries()) {
    const n = i + 1;
    const pack = L.packOf(n);
    assert.ok(L.PACKS[pack].sizes.includes(def.size), `level ${n}: size ${def.size} not in pack ${pack}`);
    assert.ok(def.size >= MIN_SIZE && def.size <= MAX_SIZE);
    assert.ok(def.pairs.length <= PALETTE.length, `level ${n}: ${def.pairs.length} colors > palette`);
    if (pack < 1) assert.equal(def.rocks.length, 0, `level ${n}: rocks before Sprout`);
    if (pack < 2) assert.equal(def.bridges.length, 0, `level ${n}: bridges before Blossom`);
  }
  // mechanics actually show up
  assert.ok(defs.slice(30).some((d) => d.rocks.length), 'rocks appear from pack 2');
  assert.ok(defs[30].rocks.length > 0, 'level 31 introduces rocks');
  assert.ok(defs[60].bridges.length > 0, 'level 61 introduces bridges');
  // later levels: fewer colors per cell (longer vines)
  const density = (d) => d.pairs.length / (d.size * d.size);
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  assert.ok(avg(defs.slice(90).map(density)) < avg(defs.slice(3, 30).map(density)), 'colors per cell drops');
});

test('tutorial levels 1–3 are small and gentle', () => {
  for (const def of defs.slice(0, 3)) {
    assert.equal(def.size, 5);
    assert.ok(def.pairs.length >= 5, 'short vines, many easy pairs');
    assert.ok(Math.max(...def.solution.map((p) => p.length)) <= 8, 'no long winding vines yet');
  }
});

test('generation is deterministic: level N is always the same', () => {
  for (const n of [1, 2, 3, 5, 17, 33, 47]) {
    const fresh = L.toCompact(L.campaignDef(n));
    assert.deepEqual(fresh, data.levels[n - 1], `level ${n} differs from levels.json`);
  }
});

test('Daily Garden: seeded by date, unique, fast', () => {
  const a = L.dailyDef('2026-10-07');
  const b = L.dailyDef('2026-10-07');
  const c = L.dailyDef('2026-10-08');
  assert.deepEqual(a.pairs, b.pairs, 'same date → same puzzle');
  assert.notDeepEqual(a.pairs, c.pairs, 'different date → different puzzle');
  for (let d = 1; d <= 14; d++) {
    const key = `2026-11-${String(d).padStart(2, '0')}`;
    const t = performance.now();
    const def = L.dailyDef(key);
    assert.ok(performance.now() - t < 1500, `daily ${key} generated quickly`);
    const res = solve(createLevel(def), { limit: 2 });
    assert.equal(res.count, 1, `daily ${key} unique`);
  }
});

test('bridge levels: solutions use both lanes of every bridge', () => {
  for (const [i, def] of defs.entries()) {
    if (!def.bridges.length) continue;
    const lvl = createLevel(def);
    const st = getStats(lvl, { vines: def.solution });
    assert.equal(st.filled, lvl.graph.activeCount, `level ${i + 1}`);
    for (const b of def.bridges) assert.equal(lvl.kind[b], BRIDGE);
  }
});

test('hints replay the solution until solved', () => {
  for (const n of [4, 40, 75, 110]) {
    const def = defs[n - 1];
    const lvl = createLevel(def);
    let s = newGame(lvl);
    for (let i = 0; i < 3; i++) s = applyHint(lvl, s, def.solution).state;
    assert.equal(s.hintsUsed, 3);
    assert.equal(applyHint(lvl, s, def.solution).color, -1, 'capped at 3');
    assert.equal(getStats(lvl, s).connected, 3);
  }
});
