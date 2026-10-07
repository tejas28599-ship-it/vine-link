import { createLevel } from '../js/game.js';

/**
 * Build a level from ASCII rows.
 *   A–L  seed of that color (exactly two each)   #  rock   +  bridge   .  soil
 */
export function parseGrid(rows) {
  const size = rows.length;
  const seeds = new Map();
  const rocks = [];
  const bridges = [];
  rows.forEach((row, r) => {
    if (row.length !== size) throw new Error(`Row ${r} has length ${row.length}, expected ${size}`);
    [...row].forEach((ch, c) => {
      const cell = r * size + c;
      if (ch === '#') rocks.push(cell);
      else if (ch === '+') bridges.push(cell);
      else if (ch !== '.') {
        if (!seeds.has(ch)) seeds.set(ch, []);
        seeds.get(ch).push(cell);
      }
    });
  });
  const letters = [...seeds.keys()].sort();
  const pairs = letters.map((l) => {
    const s = seeds.get(l);
    if (s.length !== 2) throw new Error(`Seed ${l} appears ${s.length} times`);
    return s;
  });
  return createLevel({ size, pairs, rocks, bridges });
}

/** Cell index from (row, col). */
export const at = (size) => (r, c) => r * size + c;

/** Draw a whole path through the public drag API, step by step. */
export function drawPath(game, level, state, cells) {
  const drag = game.startDrag(level, state, cells[0]);
  if (!drag) throw new Error(`Cannot start drag at ${cells[0]}`);
  let path = drag.path;
  for (const cell of cells.slice(1)) path = game.extendPath(level, drag.color, path, cell);
  return game.commitPath(level, state, drag.color, path);
}
