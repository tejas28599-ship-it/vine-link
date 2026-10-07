import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
import { parseGrid, at, drawPath } from './helpers.js';

// 5×5 with three pairs:
//   A . . . A
//   B . . . .
//   . . . . B
//   C . . . .
//   . . . . C
const basic = () =>
  parseGrid(['A...A', 'B....', '....B', 'C....', '....C']);

test('createLevel validates seeds and builds the lane graph', () => {
  const lvl = basic();
  assert.equal(lvl.size, 5);
  assert.equal(lvl.pairs.length, 3);
  assert.equal(lvl.graph.activeCount, 25);
  assert.throws(() => G.createLevel({ size: 5, pairs: [[0, 0]] }));
  assert.throws(() => G.createLevel({ size: 5, pairs: [[0, 4]], rocks: [4] }));
  assert.throws(() => G.createLevel({ size: 5, pairs: [[0, 4]], bridges: [1] }), /border/);
});

test('each step must be orthogonally adjacent', () => {
  const lvl = basic();
  const p = at(5);
  const s = G.newGame(lvl);
  const drag = G.startDrag(lvl, s, p(0, 0));
  assert.deepEqual(drag, { color: 0, path: [0] });
  // diagonal step is ignored
  assert.deepEqual(G.extendPath(lvl, 0, drag.path, p(1, 1)), [0]);
  // two cells away is ignored
  assert.deepEqual(G.extendPath(lvl, 0, drag.path, p(0, 2)), [0]);
  assert.deepEqual(G.extendPath(lvl, 0, drag.path, p(0, 1)), [0, 1]);
});

test("a vine can't enter another color's seed or a rock", () => {
  const lvl = parseGrid(['A#..A', 'B....', '....B', 'C....', '....C']);
  const p = at(5);
  // rock to the right of A
  assert.deepEqual(G.extendPath(lvl, 0, [p(0, 0)], p(0, 1)), [p(0, 0)]);
  // B's seed below A
  assert.deepEqual(G.extendPath(lvl, 0, [p(0, 0)], p(1, 0)), [p(0, 0)]);
});

test('drawing over another vine cuts it at that point', () => {
  const lvl = basic();
  const p = at(5);
  let s = G.newGame(lvl);
  // B: (1,0) → (1,4) → (2,4)
  s = drawPath(G, lvl, s, [p(1, 0), p(1, 1), p(1, 2), p(1, 3), p(1, 4), p(2, 4)]);
  assert.ok(G.isConnected(lvl, s, 1));
  // A goes down through (1,2): B must be cut to (1,0),(1,1)
  s = drawPath(G, lvl, s, [p(0, 0), p(0, 1), p(0, 2), p(1, 2)]);
  assert.deepEqual(s.vines[1], [p(1, 0), p(1, 1)]);
  assert.deepEqual(s.vines[0], [p(0, 0), p(0, 1), p(0, 2), p(1, 2)]);
});

test('a cut vine grows back if the drag pulls away again (same drag)', () => {
  const lvl = basic();
  const p = at(5);
  let s = drawPath(G, lvl, G.newGame(lvl), [p(1, 0), p(1, 1), p(1, 2), p(1, 3), p(1, 4), p(2, 4)]);
  const base = s;
  const drag = G.startDrag(lvl, base, p(0, 0));
  let path = drag.path;
  for (const c of [p(0, 1), p(1, 1)]) path = G.extendPath(lvl, 0, path, c);
  assert.deepEqual(G.applyPath(lvl, base, 0, path).vines[1], [], 'B cut back to its bare seed');
  path = G.extendPath(lvl, 0, path, p(0, 1)); // back off
  assert.deepEqual(G.applyPath(lvl, base, 0, path).vines[1], base.vines[1]);
});

test('drawing back over itself shrinks the vine to that cell', () => {
  const lvl = basic();
  const p = at(5);
  let path = [p(0, 0)];
  for (const c of [p(0, 1), p(0, 2), p(0, 3)]) path = G.extendPath(lvl, 0, path, c);
  assert.equal(path.length, 4);
  path = G.extendPath(lvl, 0, path, p(0, 2));
  assert.deepEqual(path, [p(0, 0), p(0, 1), p(0, 2)]);
  // jumping straight back to an earlier cell of the vine also shrinks
  path = G.extendPath(lvl, 0, [p(0, 0), p(0, 1), p(0, 2), p(0, 3)], p(0, 1));
  assert.deepEqual(path, [p(0, 0), p(0, 1)]);
  // back onto its own start seed → just the seed
  assert.deepEqual(G.extendPath(lvl, 0, [p(0, 0), p(0, 1)], p(0, 0)), [p(0, 0)]);
});

test('a connected vine cannot grow past its flower', () => {
  const lvl = basic();
  const p = at(5);
  const full = [p(0, 0), p(0, 1), p(0, 2), p(0, 3), p(0, 4)];
  assert.ok(G.isComplete(lvl, 0, full));
  assert.equal(G.extendPath(lvl, 0, full, p(1, 4)), full);
});

test('pair connected / level solved needs every cell filled', () => {
  const lvl = basic();
  const p = at(5);
  let s = G.newGame(lvl);
  s = drawPath(G, lvl, s, [p(0, 0), p(0, 1), p(0, 2), p(0, 3), p(0, 4)]);
  s = drawPath(G, lvl, s, [p(1, 0), p(1, 1), p(1, 2), p(1, 3), p(1, 4), p(2, 4)]);
  s = drawPath(G, lvl, s, [p(3, 0), p(3, 1), p(3, 2), p(3, 3), p(3, 4), p(4, 4)]);
  let st = G.getStats(lvl, s);
  assert.equal(st.connected, 3);
  assert.equal(st.solved, false, 'all pairs connected but cells empty');
  assert.equal(st.percent, 68);
  // B snakes through row 2, C through row 4 → every cell filled
  s = drawPath(G, lvl, s, [p(1, 0), p(2, 0), p(2, 1), p(1, 1), p(1, 2), p(2, 2), p(2, 3), p(1, 3), p(1, 4), p(2, 4)]);
  s = drawPath(G, lvl, s, [p(3, 0), p(4, 0), p(4, 1), p(3, 1), p(3, 2), p(4, 2), p(4, 3), p(3, 3), p(3, 4), p(4, 4)]);
  st = G.getStats(lvl, s);
  assert.equal(st.percent, 100);
  assert.ok(st.solved);
  assert.equal(s.moves, 5);
  assert.ok(!G.isPerfect(lvl, s), 'redrawing pairs costs extra moves');
});

test('solves a small level end to end', () => {
  // A A A        3×3: A along the top, B snakes the rest
  // B . .
  // . . B   →  B: (1,0)(2,0)(2,1)(1,1)(1,2)(2,2)
  const lvl = parseGrid(['A.A', 'B..', '..B']);
  const p = at(3);
  let s = G.newGame(lvl);
  s = drawPath(G, lvl, s, [p(0, 0), p(0, 1), p(0, 2)]);
  s = drawPath(G, lvl, s, [p(1, 0), p(2, 0), p(2, 1), p(1, 1), p(1, 2), p(2, 2)]);
  const st = G.getStats(lvl, s);
  assert.equal(st.percent, 100);
  assert.ok(st.solved);
  assert.ok(G.isPerfect(lvl, s));
});

test('moves count color changes; undo restores the board but not moves', () => {
  const lvl = basic();
  const p = at(5);
  let s = G.newGame(lvl);
  s = drawPath(G, lvl, s, [p(0, 0), p(0, 1)]);
  s = drawPath(G, lvl, s, [p(0, 1), p(0, 2)]); // same color again → still 1 move
  assert.equal(s.moves, 1);
  s = drawPath(G, lvl, s, [p(1, 0), p(1, 1)]);
  assert.equal(s.moves, 2);
  assert.equal(s.history.length, 3);
  s = G.undo(s);
  assert.deepEqual(s.vines[1], []);
  assert.deepEqual(s.vines[0], [p(0, 0), p(0, 1), p(0, 2)]);
  assert.equal(s.moves, 2);
  s = G.undo(G.undo(s));
  assert.deepEqual(s.vines[0], []);
  assert.equal(G.undo(s), s, 'undo on empty history is a no-op');
});

test('tapping a seed clears its vine; pressing mid-vine cuts it there', () => {
  const lvl = basic();
  const p = at(5);
  let s = drawPath(G, lvl, G.newGame(lvl), [p(0, 0), p(0, 1), p(0, 2), p(0, 3)]);
  const mid = G.startDrag(lvl, s, p(0, 1));
  assert.deepEqual(mid.path, [p(0, 0), p(0, 1)]);
  s = G.clearVine(lvl, s, 0);
  assert.deepEqual(s.vines[0], []);
});

test('bridges: one vine horizontally, one vertically, both straight', () => {
  // . A .        A crosses left→right, B crosses top→bottom
  // A + .   →  The bridge (1,1) holds both lanes.
  // . B .
  const lvl = parseGrid(['.B...', 'A+A..', '.B...', '.....', '.....']);
  const p = at(5);
  let s = G.newGame(lvl);
  s = drawPath(G, lvl, s, [p(1, 0), p(1, 1), p(1, 2)]);
  s = drawPath(G, lvl, s, [p(0, 1), p(1, 1), p(2, 1)]);
  assert.ok(G.isConnected(lvl, s, 0), 'horizontal vine survives');
  assert.ok(G.isConnected(lvl, s, 1), 'vertical vine crosses it');
  // can't turn on a bridge
  assert.deepEqual(G.extendPath(lvl, 0, [p(1, 0), p(1, 1)], p(0, 1)), [p(1, 0), p(1, 1)]);
  // same lane conflict cuts: a second horizontal pass would cut A
  const cut = G.applyPath(lvl, s, 1, [p(0, 1), p(0, 2), p(1, 2)]);
  assert.deepEqual(cut.vines[0], [p(1, 0), p(1, 1)]);
  const stats = G.getStats(lvl, s);
  assert.equal(stats.total, 26, 'bridge counts as two lanes');
});

test('hints draw one solution vine and cap at 3 per level', () => {
  const lvl = parseGrid(['A.A', 'B..', '..B']);
  const p = at(3);
  const solution = [
    [p(0, 0), p(0, 1), p(0, 2)],
    [p(1, 0), p(2, 0), p(2, 1), p(1, 1), p(1, 2), p(2, 2)],
  ];
  let s = drawPath(G, lvl, G.newGame(lvl), [p(1, 0), p(1, 1), p(0, 1)]); // wrong B, blocking A
  let r = G.applyHint(lvl, s, solution);
  assert.equal(r.color, 0);
  assert.deepEqual(r.state.vines[0], solution[0]);
  assert.deepEqual(r.state.vines[1], [p(1, 0), p(1, 1)], 'blocking vine was cut');
  r = G.applyHint(lvl, r.state, solution);
  assert.equal(r.color, 1);
  assert.ok(G.isSolved(lvl, r.state));
  // undo after hint removes the vine but keeps hintsUsed
  const u = G.undo(r.state);
  assert.equal(u.hintsUsed, 2);
  assert.ok(!G.isConnected(lvl, u, 1));
  const capped = { ...u, hintsUsed: 3 };
  assert.equal(G.applyHint(lvl, capped, solution).color, -1);
});

test('restoreState rejects corrupt or mismatched saves', () => {
  const lvl = basic();
  const p = at(5);
  const s = drawPath(G, lvl, G.newGame(lvl), [p(0, 0), p(0, 1), p(0, 2)]);
  const saved = JSON.parse(JSON.stringify(G.serializeState(s)));
  const back = G.restoreState(lvl, saved);
  assert.deepEqual(back.vines, s.vines);
  assert.equal(G.restoreState(lvl, { vines: [[0, 2]] }), null);
  assert.equal(G.restoreState(lvl, { vines: [[0, 1], [], [15, 10, 5]] }), null, 'C enters B seed');
  assert.equal(G.restoreState(lvl, { vines: [[0, 1, 6], [5, 6], []] }), null, 'overlapping vines');
  assert.equal(G.restoreState(lvl, null), null);
});
