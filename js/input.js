// Vine Link — pointer input. One pointer at a time (extra fingers are ignored), works for touch,
// mouse and pen. Fast swipes are expanded into every grid cell the finger crossed (supercover
// traversal), so diagonal flicks never skip cells.

/**
 * Every grid cell the segment (ax, ay) → (bx, by) passes through, in order, 4-connected
 * (Amanatides & Woo traversal). Coordinates are in cell units; cells outside the n×n board are
 * skipped. Exact corner crossings step horizontally first.
 */
export function traverseCells(ax, ay, bx, by, n, visit) {
  let cx = Math.floor(ax), cy = Math.floor(ay);
  const ex = Math.floor(bx), ey = Math.floor(by);
  const dx = bx - ax, dy = by - ay;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const tdx = sx ? Math.abs(1 / dx) : Infinity;
  const tdy = sy ? Math.abs(1 / dy) : Infinity;
  let tmx = sx > 0 ? (cx + 1 - ax) * tdx : sx < 0 ? (ax - cx) * tdx : Infinity;
  let tmy = sy > 0 ? (cy + 1 - ay) * tdy : sy < 0 ? (ay - cy) * tdy : Infinity;
  const steps = Math.abs(ex - cx) + Math.abs(ey - cy); // exact number of cell crossings
  for (let i = 0; i < steps; i++) {
    if (tmx <= tmy) { cx += sx; tmx += tdx; } else { cy += sy; tmy += tdy; }
    if (cx >= 0 && cy >= 0 && cx < n && cy < n) visit(cy * n + cx);
  }
}

/**
 * @param {HTMLElement} el            element receiving pointer events (the board canvas)
 * @param {() => {x:number,y:number,cell:number,size:number}} geom  board origin/cell size in CSS px
 * @param {{down(p), cell(index, p), move(p), up(p, cancelled)}} handlers
 */
export function attachInput(el, geom, handlers) {
  let active = null; // pointerId being tracked
  let last = null; // last position in grid units

  const toGrid = (e) => {
    const r = el.getBoundingClientRect();
    const g = geom();
    const x = (e.clientX - r.left - g.x) / g.cell;
    const y = (e.clientY - r.top - g.y) / g.cell;
    return { gx: x, gy: y, px: e.clientX - r.left, py: e.clientY - r.top, size: g.size };
  };

  function onDown(e) {
    if (active !== null) return; // multi-touch: keep following the first finger only
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    active = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    last = toGrid(e);
    handlers.down(last);
  }

  function onMove(e) {
    if (e.pointerId !== active) return;
    e.preventDefault();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const list = events && events.length ? events : [e];
    for (const ev of list) {
      const p = toGrid(ev);
      // Walk every cell between the last and current position; off-board cells are skipped,
      // so swipes that leave the board and come back (or clip a corner) still register.
      if (Math.floor(p.gx) !== Math.floor(last.gx) || Math.floor(p.gy) !== Math.floor(last.gy)) {
        traverseCells(last.gx, last.gy, p.gx, p.gy, p.size, (cell) => handlers.cell(cell, p));
      }
      last = p;
    }
    handlers.move(last);
  }

  function finish(e, cancelled) {
    if (e.pointerId !== active) return;
    active = null;
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    handlers.up(last, cancelled);
    last = null;
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', (e) => finish(e, false));
  el.addEventListener('pointercancel', (e) => finish(e, true));
  el.addEventListener('lostpointercapture', (e) => finish(e, true));
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    get dragging() {
      return active !== null;
    },
    /** Abort the current drag (e.g. the level changed underneath it). */
    cancel() {
      if (active === null) return;
      const id = active;
      active = null;
      try { el.releasePointerCapture(id); } catch { /* ignore */ }
      handlers.up(last, true);
      last = null;
    },
  };
}
