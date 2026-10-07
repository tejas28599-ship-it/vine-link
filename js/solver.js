// Vine Link — backtracking solver over the lane graph (see game.js). Pure, no DOM.
//
// Every pair grows from BOTH seeds; at each step we extend the most constrained head (fewest
// legal moves). Branches are pruned when:
//   • an empty node has fewer than two possible neighbours (it could never be passed through),
//   • a pair's two heads can no longer reach each other through empty nodes,
//   • an empty region touches no pair that could fill it (both heads must border the region).
// It counts solutions up to `limit`, so `limit: 2` proves uniqueness. All budgets are in search
// steps (never wall-clock time) so results are deterministic on every device.

import { nodesToCells } from './game.js';

export function solve(level, { limit = 2, maxSteps = 2_000_000 } = {}) {
  const g = level.graph;
  const M = g.nodeCount;
  const K = level.pairs.length;
  const adj = g.adj;

  const color = new Int8Array(M).fill(-2); // -2 inactive, -1 empty, else color
  for (let v = 0; v < M; v++) if (g.active[v]) color[v] = -1;
  const headOf = new Int8Array(M).fill(-1); // color whose live head sits here
  const par = new Int32Array(M).fill(-1);
  const heads = new Int32Array(2 * K);
  const done = new Uint8Array(K);
  const joinX = new Int32Array(K);
  const joinY = new Int32Array(K);
  let empty = g.activeCount;

  for (let c = 0; c < K; c++) {
    const { a, b } = level.pairs[c];
    color[a] = c;
    color[b] = c;
    heads[2 * c] = a;
    heads[2 * c + 1] = b;
    headOf[a] = c;
    headOf[b] = c;
    empty -= 2;
  }

  const comp = new Int32Array(M);
  const stack = new Int32Array(M);
  const touched = new Uint8Array(M + 1);
  const solutions = [];
  let steps = 0;
  let aborted = false;

  function feasible() {
    // Dead ends
    for (let v = 0; v < M; v++) {
      if (color[v] !== -1) continue;
      const nb = adj[v];
      let deg = 0;
      for (let i = 0; i < nb.length; i++) {
        const u = nb[i];
        if (color[u] === -1 || headOf[u] >= 0) deg++;
      }
      if (deg < 2) return false;
    }
    // Empty regions
    comp.fill(-1);
    let nc = 0;
    for (let v = 0; v < M; v++) {
      if (color[v] !== -1 || comp[v] !== -1) continue;
      let sp = 0;
      stack[sp++] = v;
      comp[v] = nc;
      while (sp) {
        const x = stack[--sp];
        const nb = adj[x];
        for (let i = 0; i < nb.length; i++) {
          const u = nb[i];
          if (color[u] === -1 && comp[u] === -1) {
            comp[u] = nc;
            stack[sp++] = u;
          }
        }
      }
      nc++;
    }
    touched.fill(0, 0, nc);
    for (let c = 0; c < K; c++) {
      if (done[c]) continue;
      const ha = heads[2 * c], hb = heads[2 * c + 1];
      const na = adj[ha], nb = adj[hb];
      let ok = false;
      for (let i = 0; i < na.length; i++) {
        const u = na[i];
        if (u === hb) ok = true;
        if (color[u] !== -1) continue;
        const k = comp[u];
        for (let j = 0; j < nb.length; j++) {
          const w = nb[j];
          if (color[w] === -1 && comp[w] === k) {
            touched[k] = 1;
            ok = true;
          }
        }
      }
      if (!ok) return false;
    }
    for (let k = 0; k < nc; k++) if (!touched[k]) return false;
    return true;
  }

  function record() {
    const paths = [];
    for (let c = 0; c < K; c++) {
      const chainX = [];
      for (let v = joinX[c]; v !== -1; v = par[v]) chainX.push(v);
      const chainY = [];
      for (let v = joinY[c]; v !== -1; v = par[v]) chainY.push(v);
      // chainX ends at one seed, chainY at the other; orient from seed a
      let nodes;
      if (chainX[chainX.length - 1] === level.pairs[c].a) nodes = chainX.reverse().concat(chainY);
      else nodes = chainY.reverse().concat(chainX);
      paths.push(nodesToCells(level, nodes));
    }
    solutions.push(paths);
  }

  function search() {
    if (++steps > maxSteps) {
      aborted = true;
      return;
    }
    let best = -1;
    let bestCnt = 1e9;
    let remaining = 0;
    for (let c = 0; c < K; c++) {
      if (done[c]) continue;
      remaining++;
      for (let e = 0; e < 2; e++) {
        const h = heads[2 * c + e];
        const o = heads[2 * c + 1 - e];
        const nb = adj[h];
        let cnt = 0;
        for (let i = 0; i < nb.length; i++) {
          const u = nb[i];
          if (color[u] === -1 || u === o) cnt++;
        }
        if (cnt === 0) return;
        if (cnt < bestCnt) {
          bestCnt = cnt;
          best = 2 * c + e;
        }
      }
    }
    if (remaining === 0) {
      if (empty === 0) record();
      return;
    }
    if (!feasible()) return;

    const c = best >> 1;
    const h = heads[best];
    const o = heads[best ^ 1];
    const nb = adj[h];
    for (let i = 0; i < nb.length; i++) {
      const u = nb[i];
      if (u === o) {
        done[c] = 1;
        joinX[c] = h;
        joinY[c] = o;
        headOf[h] = -1;
        headOf[o] = -1;
        search();
        headOf[h] = c;
        headOf[o] = c;
        done[c] = 0;
      } else if (color[u] === -1) {
        color[u] = c;
        par[u] = h;
        heads[best] = u;
        headOf[h] = -1;
        headOf[u] = c;
        empty--;
        search();
        empty++;
        headOf[u] = -1;
        headOf[h] = c;
        heads[best] = h;
        color[u] = -1;
      }
      if (solutions.length >= limit || aborted) return;
    }
  }

  search();
  return {
    count: solutions.length,
    unique: !aborted && solutions.length === 1,
    solution: solutions[0] || null,
    solutions,
    aborted,
    steps,
  };
}
