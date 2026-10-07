// Vine Link — core rules. Pure functions only: no DOM, no randomness, no mutation of inputs.
//
// Cells are indices `row * size + col`. Internally the board is a "lane graph": every soil cell
// is one node, every bridge cell is two nodes (horizontal lane = cell, vertical lane =
// cellCount + cell). Paths in that graph are exactly the legal vines.

export const SOIL = 0;
export const ROCK = 1;
export const BRIDGE = 2;
export const H = 0;
export const V = 1;
export const MIN_SIZE = 5;
export const MAX_SIZE = 12;
export const MAX_HINTS = 3;
const HISTORY_LIMIT = 300;

// ---------------------------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------------------------

/**
 * Build a runtime level from a definition.
 * def: { size, pairs: [[a, b], ...], rocks?: [], bridges?: [], solution?: [[cells]], id?, meta? }
 */
export function createLevel(def) {
  const size = def.size;
  if (!Number.isInteger(size) || size < 2 || size > MAX_SIZE) throw new Error(`Bad grid size ${size}`);
  const cellCount = size * size;
  const kind = new Uint8Array(cellCount);
  const inRange = (c) => Number.isInteger(c) && c >= 0 && c < cellCount;

  for (const r of def.rocks || []) {
    if (!inRange(r)) throw new Error(`Rock out of range: ${r}`);
    kind[r] = ROCK;
  }
  for (const b of def.bridges || []) {
    if (!inRange(b) || kind[b] !== SOIL) throw new Error(`Bad bridge cell: ${b}`);
    const r = Math.floor(b / size), c = b % size;
    if (r === 0 || c === 0 || r === size - 1 || c === size - 1) throw new Error(`Bridge on border: ${b}`);
    kind[b] = BRIDGE;
  }

  const seedColor = new Int8Array(cellCount).fill(-1);
  const pairs = def.pairs.map(([a, b], color) => {
    for (const s of [a, b]) {
      if (!inRange(s)) throw new Error(`Seed out of range: ${s}`);
      if (kind[s] !== SOIL) throw new Error(`Seed on rock/bridge: ${s}`);
      if (seedColor[s] !== -1) throw new Error(`Two seeds on cell ${s}`);
      seedColor[s] = color;
    }
    return { a, b };
  });

  const level = {
    id: def.id ?? null,
    size,
    cellCount,
    kind,
    seedColor,
    pairs,
    rocks: [...(def.rocks || [])],
    bridges: [...(def.bridges || [])],
    solution: def.solution || null,
    meta: def.meta || {},
  };
  level.graph = buildGraph(level);
  return level;
}

/** Lane graph: adjacency lists over node ids (see header comment). */
export function buildGraph(level) {
  const { size, cellCount, kind } = level;
  const nodeCount = cellCount * 2;
  const active = new Uint8Array(nodeCount);
  const lists = Array.from({ length: nodeCount }, () => []);
  let activeCount = 0;
  for (let cell = 0; cell < cellCount; cell++) {
    if (kind[cell] === ROCK) continue;
    active[cell] = 1;
    activeCount++;
    if (kind[cell] === BRIDGE) {
      active[cellCount + cell] = 1;
      activeCount++;
    }
  }
  const link = (x, y) => {
    lists[x].push(y);
    lists[y].push(x);
  };
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = r * size + c;
      if (kind[cell] === ROCK) continue;
      if (c + 1 < size && kind[cell + 1] !== ROCK) link(nodeOf(level, cell, H), nodeOf(level, cell + 1, H));
      if (r + 1 < size && kind[cell + size] !== ROCK) link(nodeOf(level, cell, V), nodeOf(level, cell + size, V));
    }
  }
  return { nodeCount, active, adj: lists, activeCount };
}

export function nodeOf(level, cell, axis) {
  return level.kind[cell] === BRIDGE && axis === V ? level.cellCount + cell : cell;
}

export function cellOfNode(level, node) {
  return node % level.cellCount;
}

export function isAdjacent(size, a, b) {
  const ra = Math.floor(a / size), rb = Math.floor(b / size);
  const ca = a % size, cb = b % size;
  return (ra === rb && Math.abs(ca - cb) === 1) || (ca === cb && Math.abs(ra - rb) === 1);
}

/** Axis of the step between two adjacent cells. */
export function axisBetween(a, b) {
  return Math.abs(a - b) === 1 ? H : V;
}

/** Lane-graph node occupied by path[i]. */
export function pathNode(level, path, i) {
  const cell = path[i];
  if (level.kind[cell] !== BRIDGE) return cell;
  const other = i > 0 ? path[i - 1] : path[i + 1];
  if (other === undefined) return cell;
  return nodeOf(level, cell, axisBetween(cell, other));
}

export function pathNodes(level, path) {
  const out = new Array(path.length);
  for (let i = 0; i < path.length; i++) out[i] = pathNode(level, path, i);
  return out;
}

/** Cell path from a node path (solver output). */
export function nodesToCells(level, nodes) {
  return nodes.map((n) => cellOfNode(level, n));
}

/** Check a cell path obeys every movement rule for `color`. */
export function isValidPath(level, color, path) {
  if (!Array.isArray(path)) return false;
  if (path.length === 0) return true;
  const { a, b } = level.pairs[color] || {};
  if (path[0] !== a && path[0] !== b) return false;
  const seen = new Set();
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    if (!Number.isInteger(cell) || cell < 0 || cell >= level.cellCount) return false;
    if (level.kind[cell] === ROCK) return false;
    const sc = level.seedColor[cell];
    if (sc !== -1 && sc !== color) return false;
    if (i > 0) {
      if (!isAdjacent(level.size, path[i - 1], cell)) return false;
      if (sc === color && i < path.length - 1) return false; // can't pass through own seeds
    }
    if (i > 0 && i < path.length - 1 && level.kind[cell] === BRIDGE) {
      if (cell - path[i - 1] !== path[i + 1] - cell) return false; // straight across bridges
    }
    const node = pathNode(level, path, i);
    if (seen.has(node)) return false;
    seen.add(node);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

export function newGame(level) {
  return {
    vines: level.pairs.map(() => []),
    moves: 0,
    lastColor: -1,
    hintsUsed: 0,
    history: [],
  };
}

export function otherSeed(level, color, seed) {
  const p = level.pairs[color];
  return seed === p.a ? p.b : p.a;
}

/** A vine is complete when it runs from one of its seeds to the other. */
export function isComplete(level, color, path) {
  if (path.length < 2) return false;
  return path[path.length - 1] === otherSeed(level, color, path[0]);
}

export function isConnected(level, state, color) {
  return isComplete(level, color, state.vines[color]);
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

/**
 * Begin a drag on `cell`. Returns { color, path } or null.
 *  - A seed that is the far end of its connected vine: keep the vine, drag back from there.
 *  - Any other seed: start a fresh vine from that seed.
 *  - A vine cell: cut the vine back to that cell and keep drawing from it.
 */
export function startDrag(level, state, cell) {
  if (cell < 0 || cell >= level.cellCount) return null;
  const sc = level.seedColor[cell];
  if (sc >= 0) {
    const v = state.vines[sc];
    if (v.length > 1 && v[v.length - 1] === cell) return { color: sc, path: v.slice() };
    return { color: sc, path: [cell] };
  }
  let found = null;
  for (let c = 0; c < state.vines.length; c++) {
    const v = state.vines[c];
    const j = v.lastIndexOf(cell);
    if (j < 0) continue;
    if (j === v.length - 1) return { color: c, path: v.slice() }; // prefer a vine whose tip is here
    if (!found) found = { color: c, path: v.slice(0, j + 1) };
  }
  return found;
}

/**
 * Advance a drag path toward `cell`. Returns the new path (or the same array when the move is
 * not allowed). Moving back over the vine shrinks it to that cell.
 */
export function extendPath(level, color, path, cell) {
  if (!path.length || cell < 0 || cell >= level.cellCount) return path;
  const head = path[path.length - 1];
  if (cell === head) return path;
  const nodes = pathNodes(level, path);

  if (!isAdjacent(level.size, head, cell)) {
    // Not a legal single step; only allow jumping back along the vine itself.
    const j = path.lastIndexOf(cell);
    return j >= 0 ? path.slice(0, j + 1) : path;
  }
  if (level.kind[cell] === ROCK) return path;

  const axis = axisBetween(head, cell);
  const node = nodeOf(level, cell, axis);
  const back = nodes.indexOf(node);
  if (back >= 0) return path.slice(0, back + 1); // drawn back over itself → shrink

  // A vine on a bridge must leave it in a straight line.
  if (level.kind[head] === BRIDGE && path.length >= 2) {
    const prev = path[path.length - 2];
    if (cell - head !== head - prev) return path;
  }
  const sc = level.seedColor[cell];
  if (sc >= 0 && sc !== color) return path; // other color's seed blocks
  if (isComplete(level, color, path)) return path; // already bloomed: can only shrink
  return [...path, cell];
}

/**
 * Preview of the board with `color` drawn as `path`: every other vine that overlaps it is cut
 * just before the first shared lane. Always computed from the state at drag start, so cut vines
 * regrow if the drag pulls back off them.
 */
export function applyPath(level, base, color, path) {
  const occupied = new Set(path.length > 1 ? pathNodes(level, path) : []);
  const vines = base.vines.map((v, c) => {
    if (c === color) return path.length > 1 ? path : [];
    if (v.length === 0 || occupied.size === 0) return v;
    const nodes = pathNodes(level, v);
    for (let k = 0; k < nodes.length; k++) {
      if (occupied.has(nodes[k])) return k <= 1 ? [] : v.slice(0, k);
    }
    return v;
  });
  return { ...base, vines };
}

function sameVines(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (x.length !== y.length) return false;
    for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) return false;
  }
  return true;
}

/** Commit a drawn path as one undoable action. No-op if nothing changed. */
export function commitPath(level, base, color, path) {
  const next = applyPath(level, base, color, path);
  if (sameVines(next.vines, base.vines)) return base;
  const history = [...base.history, { vines: base.vines, lastColor: base.lastColor }];
  if (history.length > HISTORY_LIMIT) history.shift();
  return {
    ...next,
    moves: base.moves + (color !== base.lastColor ? 1 : 0),
    lastColor: color,
    history,
  };
}

export function clearVine(level, state, color) {
  return commitPath(level, state, color, []);
}

/** Which vines were shortened going from `before` to `after` (for retract effects). */
export function cutColors(before, after, except = -1) {
  const out = [];
  for (let c = 0; c < before.vines.length; c++) {
    if (c !== except && after.vines[c].length < before.vines[c].length) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Undo / restart
// ---------------------------------------------------------------------------------------------

/** Undo restores the board; moves and hints already spent are not refunded. */
export function undo(state) {
  if (!state.history.length) return state;
  const prev = state.history[state.history.length - 1];
  return { ...state, vines: prev.vines, lastColor: prev.lastColor, history: state.history.slice(0, -1) };
}

export function restart(level, state) {
  return { ...newGame(level), hintsUsed: state.hintsUsed };
}

// ---------------------------------------------------------------------------------------------
// Progress / win
// ---------------------------------------------------------------------------------------------

export function getStats(level, state) {
  const covered = new Uint8Array(level.graph.nodeCount);
  let filled = 0;
  for (const v of state.vines) {
    if (v.length < 2) continue;
    for (let i = 0; i < v.length; i++) {
      const n = pathNode(level, v, i);
      if (!covered[n]) {
        covered[n] = 1;
        filled++;
      }
    }
  }
  let connected = 0;
  for (let c = 0; c < level.pairs.length; c++) if (isConnected(level, state, c)) connected++;
  const total = level.graph.activeCount;
  const pairs = level.pairs.length;
  return {
    connected,
    pairs,
    filled,
    total,
    percent: filled === total ? 100 : Math.floor((filled * 100) / total),
    solved: connected === pairs && filled === total,
  };
}

export function isSolved(level, state) {
  return getStats(level, state).solved;
}

/** "Perfect": solved with exactly one move per pair. */
export function isPerfect(level, state) {
  return isSolved(level, state) && state.moves <= level.pairs.length;
}

// ---------------------------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------------------------

function samePath(a, b) {
  if (a.length !== b.length) return false;
  let fwd = true, rev = true;
  for (let i = 0; i < a.length && (fwd || rev); i++) {
    if (a[i] !== b[i]) fwd = false;
    if (a[i] !== b[b.length - 1 - i]) rev = false;
  }
  return fwd || rev;
}

/** Color the next hint should draw, or -1 when every vine already matches the solution. */
export function hintColor(level, state, solution) {
  let fallback = -1;
  for (let c = 0; c < level.pairs.length; c++) {
    const v = state.vines[c];
    if (samePath(v, solution[c])) continue;
    if (v.length < 2) return c; // prefer pairs the player hasn't touched
    if (fallback < 0) fallback = c;
  }
  return fallback;
}

/** Draw one correct vine fully. Counts as a move; cuts anything in its way. */
export function applyHint(level, state, solution) {
  if (state.hintsUsed >= MAX_HINTS) return { state, color: -1 };
  const color = hintColor(level, state, solution);
  if (color < 0) return { state, color: -1 };
  const next = commitPath(level, state, color, solution[color].slice());
  return { state: { ...next, hintsUsed: state.hintsUsed + 1 }, color };
}

// ---------------------------------------------------------------------------------------------
// Serialization (for saving an in-progress level)
// ---------------------------------------------------------------------------------------------

export function serializeState(state) {
  return {
    vines: state.vines,
    moves: state.moves,
    lastColor: state.lastColor,
    hintsUsed: state.hintsUsed,
    history: state.history.slice(-50),
  };
}

/** Rebuild a saved state, rejecting anything that doesn't fit this level. */
export function restoreState(level, saved) {
  if (!saved || !Array.isArray(saved.vines) || saved.vines.length !== level.pairs.length) return null;
  const okVines = (vines) =>
    Array.isArray(vines) && vines.length === level.pairs.length && vines.every((v, c) => isValidPath(level, c, v));
  if (!okVines(saved.vines)) return null;
  // vines must not overlap each other
  const used = new Set();
  for (const v of saved.vines) {
    if (v.length < 2) continue;
    for (const n of pathNodes(level, v)) {
      if (used.has(n)) return null;
      used.add(n);
    }
  }
  const history = Array.isArray(saved.history) ? saved.history.filter((h) => h && okVines(h.vines)) : [];
  return {
    vines: saved.vines.map((v) => (v.length > 1 ? v.slice() : [])),
    moves: Number.isInteger(saved.moves) && saved.moves >= 0 ? saved.moves : 0,
    lastColor: Number.isInteger(saved.lastColor) ? saved.lastColor : -1,
    hintsUsed: Math.min(MAX_HINTS, Math.max(0, saved.hintsUsed | 0)),
    history: history.map((h) => ({ vines: h.vines, lastColor: h.lastColor ?? -1 })),
  };
}
