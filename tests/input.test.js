import test from 'node:test';
import assert from 'node:assert/strict';
import { traverseCells } from '../js/input.js';
import { isAdjacent } from '../js/game.js';

const cellsOf = (ax, ay, bx, by, n = 8) => {
  const out = [];
  traverseCells(ax, ay, bx, by, n, (c) => out.push(c));
  return out;
};

test('a fast diagonal swipe visits every cell in between, 4-connected', () => {
  const n = 8;
  // one pointer event jumping from cell (0,0) to cell (7,7)
  const cells = [0, ...cellsOf(0.5, 0.5, 7.5, 7.5, n)];
  assert.equal(cells.at(-1), 63);
  assert.equal(cells.length, 15, '7 right + 7 down + start');
  for (let i = 1; i < cells.length; i++) assert.ok(isAdjacent(n, cells[i - 1], cells[i]), `gap at ${i}`);
});

test('shallow and steep swipes in every direction are gap-free', () => {
  const n = 10;
  for (const [ax, ay, bx, by] of [
    [0.2, 0.9, 9.7, 3.1],
    [9.5, 9.5, 0.1, 0.4],
    [4.5, 0.5, 5.2, 9.9],
    [8.8, 1.2, 1.1, 6.6],
  ]) {
    const start = Math.floor(ay) * n + Math.floor(ax);
    const cells = [start, ...cellsOf(ax, ay, bx, by, n)];
    for (let i = 1; i < cells.length; i++) assert.ok(isAdjacent(n, cells[i - 1], cells[i]));
    assert.equal(cells.at(-1), Math.floor(by) * n + Math.floor(bx));
  }
});

test('positions off the board are skipped, cells on the way back are kept', () => {
  const n = 5;
  // from inside, out past the right edge
  assert.deepEqual(cellsOf(2.5, 2.5, 7.5, 2.5, n), [13, 14]);
  // from far outside back into the grid along row 1
  assert.deepEqual(cellsOf(-6, 1.5, 1.5, 1.5, n), [5, 6]);
  // both ends outside, but the swipe clips the corner cell
  assert.deepEqual(cellsOf(3.5, -0.5, 5.5, 1.5, n), [4]);
  // staying in the same cell visits nothing
  assert.deepEqual(cellsOf(1.2, 1.2, 1.8, 1.7, n), []);
});
