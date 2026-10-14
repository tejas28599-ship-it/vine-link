// Vine Link — canvas renderer. Clean, high-contrast look: black board, thin grid, solid dots,
// thick straight pipes with rounded ends, and filled cells tinted in their pipe's color.
//
// Performance: no shadows or blur, the rAF loop only runs while something moves, and the device
// pixel ratio is capped at 2.

import { COLORS, PALETTE, rgba } from './palette.js';
import { ROCK, BRIDGE, isComplete } from './game.js';

const TAU = Math.PI * 2;
const GRID = '#77722F';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export class BoardRenderer {
  constructor(canvas, magnifier) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mag = magnifier;
    this.magCtx = magnifier ? magnifier.getContext('2d') : null;
    this.level = null;
    this.cssSize = 0;
    this.dpr = 1;
    this.colorblind = false;
    this.raf = 0;
    this.lastT = 0;
    this.pointer = null;
    this.active = null; // { color, head } while dragging
    this.celebrating = false;
    this.reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.frame = this.frame.bind(this);
  }

  // ------------------------------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------------------------------

  setLevel(level, state) {
    this.level = level;
    this.n = level.size;
    const K = level.pairs.length;
    this.display = Array.from({ length: K }, () => ({ path: [], shown: 0, target: 0, pending: null }));
    this.done = Array.from({ length: K }, () => ({ on: false, t0: -1e9 }));
    this.cover = new Float32Array(level.cellCount);
    this.coverTarget = new Float32Array(level.cellCount);
    this.coverColor = new Int8Array(level.cellCount).fill(-1);
    this.flashes = [];
    this.celebrating = false;
    this.active = null;
    this.pointer = null;
    if (state) this.setState(state, { instant: true });
    this.request();
  }

  setColorblind(on) {
    this.colorblind = !!on;
    this.request();
  }

  resize(cssSize) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cssSize === this.cssSize && dpr === this.dpr) return;
    this.cssSize = cssSize;
    this.dpr = dpr;
    this.canvas.style.width = `${cssSize}px`;
    this.canvas.style.height = `${cssSize}px`;
    this.canvas.width = Math.round(cssSize * dpr);
    this.canvas.height = Math.round(cssSize * dpr);
    if (this.mag) {
      const m = 116;
      this.mag.width = Math.round(m * dpr);
      this.mag.height = Math.round(m * dpr);
      this.mag.style.width = `${m}px`;
      this.mag.style.height = `${m}px`;
    }
    this.request();
  }

  /** Board geometry in CSS pixels (used by input). */
  geom() {
    const pad = 1;
    const cell = (this.cssSize - pad * 2) / (this.n || 1);
    return { x: pad, y: pad, cell, size: this.n || 1 };
  }

  center(cell) {
    const g = this.geom();
    const r = Math.floor(cell / this.n), c = cell % this.n;
    return [g.x + (c + 0.5) * g.cell, g.y + (r + 0.5) * g.cell];
  }

  // ------------------------------------------------------------------------------------------
  // State → animation targets
  // ------------------------------------------------------------------------------------------

  setState(state, { instant = false } = {}) {
    const { level } = this;
    if (!level) return;
    const now = performance.now();
    this.coverTarget.fill(0);
    for (let c = 0; c < level.pairs.length; c++) {
      const next = state.vines[c];
      const d = this.display[c];
      let k = 0;
      while (k < d.path.length && k < next.length && d.path[k] === next[k]) k++;
      if (instant) {
        d.path = next;
        d.shown = d.target = next.length;
        d.pending = null;
      } else if (k === d.path.length) {
        d.path = next; // grows from here
        d.target = next.length;
        d.pending = null;
      } else if (k === next.length) {
        d.target = next.length; // shrink along the old path, then swap
        d.pending = next;
      } else {
        d.path = next; // different route: retract to the fork, then extend the new branch
        d.shown = Math.min(d.shown, k);
        d.target = next.length;
        d.pending = null;
      }
      const complete = isComplete(level, c, next);
      const f = this.done[c];
      if (complete !== f.on) {
        f.on = complete;
        f.t0 = instant ? now - 5000 : now;
        if (complete && !instant) this.flashes.push({ color: c, t0: now });
      }
      if (next.length > 1) for (const cell of next) {
        this.coverTarget[cell] = 1;
        this.coverColor[cell] = c;
      }
    }
    if (instant) this.cover.set(this.coverTarget);
    this.request();
  }

  /** Flash a pair's dots (used for hints). */
  pulse(color) {
    this.flashes.push({ color, t0: performance.now() });
    this.request();
  }

  setActive(active) {
    this.active = active;
    this.request();
  }

  setPointer(p) {
    this.pointer = p;
    if (!p && this.mag) this.mag.classList.remove('show');
    this.request();
  }

  celebrate(on) {
    this.celebrating = on;
    this.request();
  }

  // ------------------------------------------------------------------------------------------
  // Loop
  // ------------------------------------------------------------------------------------------

  request() {
    if (!this.raf && this.level && this.cssSize) this.raf = requestAnimationFrame(this.frame);
  }

  frame(now) {
    this.raf = 0;
    const dt = Math.min(0.05, this.lastT ? (now - this.lastT) / 1000 : 0.016);
    this.lastT = now;
    const busy = this.step(dt, now) || this.celebrating || !!this.pointer;
    this.draw(now);
    if (this.pointer) this.drawMagnifier();
    if (busy) this.request();
    else this.lastT = 0;
  }

  step(dt, now) {
    let busy = false;
    for (const d of this.display) {
      const diff = d.target - d.shown;
      if (Math.abs(diff) > 0.001) {
        const amt = Math.max(Math.abs(diff) * dt * 16, dt * (diff < 0 ? 10 : 6));
        d.shown = Math.abs(diff) <= amt || this.reduceMotion ? d.target : d.shown + Math.sign(diff) * amt;
        busy = true;
      } else if (d.pending) {
        d.path = d.pending;
        d.pending = null;
        d.shown = d.target = d.path.length;
      }
    }
    for (let i = 0; i < this.cover.length; i++) {
      const diff = this.coverTarget[i] - this.cover[i];
      if (Math.abs(diff) > 0.01) {
        this.cover[i] += diff * Math.min(1, dt * 14);
        busy = true;
      } else this.cover[i] = this.coverTarget[i];
    }
    this.flashes = this.flashes.filter((f) => now - f.t0 < 450);
    if (this.flashes.length) busy = true;
    for (const f of this.done) if (now - f.t0 < 300) busy = true;
    return busy;
  }

  // ------------------------------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------------------------------

  draw(now) {
    const { ctx, level, dpr } = this;
    if (!level) return;
    const g = this.geom();
    const cs = g.cell;
    const n = this.n;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.cssSize, this.cssSize);

    // cells: blocked tiles and color tint on filled cells
    for (let cell = 0; cell < level.cellCount; cell++) {
      const x = g.x + (cell % n) * cs, y = g.y + Math.floor(cell / n) * cs;
      if (level.kind[cell] === ROCK) {
        ctx.fillStyle = '#2B2B2B';
        ctx.fillRect(x, y, cs, cs);
        ctx.strokeStyle = '#444';
        ctx.lineWidth = Math.max(1, cs * 0.05);
        ctx.beginPath();
        ctx.moveTo(x + cs * 0.25, y + cs * 0.25);
        ctx.lineTo(x + cs * 0.75, y + cs * 0.75);
        ctx.moveTo(x + cs * 0.75, y + cs * 0.25);
        ctx.lineTo(x + cs * 0.25, y + cs * 0.75);
        ctx.stroke();
        continue;
      }
      const a = this.cover[cell];
      const col = this.coverColor[cell];
      if (a > 0.01 && col >= 0) {
        ctx.fillStyle = rgba(COLORS[col].rgb, 0.3 * a);
        ctx.fillRect(x, y, cs, cs);
      }
    }

    this.drawGrid(g);

    // the finger: a big translucent circle in the active color
    if (this.active && this.pointer) {
      ctx.fillStyle = rgba(COLORS[this.active.color].rgb, 0.35);
      ctx.beginPath();
      ctx.arc(this.pointer.px, this.pointer.py, cs * 0.75, 0, TAU);
      ctx.fill();
    }

    // pipes
    const width = cs * 0.34;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const lines = this.display.map((d) => this.pipePoints(d));
    lines.forEach((pts, c) => {
      if (pts) this.strokePts(pts, width, rgba(COLORS[c].rgb));
    });
    if (level.bridges.length) this.drawBridges(lines, g, width);

    // dots
    for (let c = 0; c < level.pairs.length; c++) {
      const { a, b } = level.pairs[c];
      const f = this.done[c];
      const t = clamp((now - f.t0) / 300, 0, 1);
      // a quick "pop" when a pair connects
      let scale = f.on && !this.reduceMotion ? 1 + 0.22 * Math.sin(Math.PI * t) : 1;
      if (this.celebrating) scale *= 1 + 0.06 * Math.sin(now / 180 + c);
      for (const cell of [a, b]) this.drawDot(c, cell, cs * 0.34 * scale);
    }

    // expanding ring when a pair connects (or a hint lands)
    for (const fl of this.flashes) {
      const t = clamp((now - fl.t0) / 450, 0, 1);
      const { a, b } = level.pairs[fl.color];
      ctx.strokeStyle = rgba(COLORS[fl.color].rgb, 0.8 * (1 - t));
      ctx.lineWidth = Math.max(1.5, cs * 0.06);
      for (const cell of [a, b]) {
        const [x, y] = this.center(cell);
        ctx.beginPath();
        ctx.arc(x, y, cs * (0.34 + 0.4 * t), 0, TAU);
        ctx.stroke();
      }
    }
  }

  drawGrid(g) {
    const { ctx, n } = this;
    const cs = g.cell;
    const end = g.x + n * cs;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const p = Math.round((g.x + i * cs) * this.dpr) / this.dpr + 0.5 / this.dpr;
      ctx.moveTo(p, g.y);
      ctx.lineTo(p, end);
      ctx.moveTo(g.x, p);
      ctx.lineTo(end, p);
    }
    ctx.stroke();
  }

  /** Points of a pipe's centerline, with the last segment cut to the animated length. */
  pipePoints(d) {
    const L = d.path.length;
    const shown = Math.min(d.shown, L);
    if (L < 2 || shown <= 1.001) return null;
    const whole = Math.floor(shown);
    const pts = [];
    for (let i = 0; i < whole; i++) pts.push(...this.center(d.path[i]));
    const frac = shown - whole;
    if (frac > 0.001 && whole < L) {
      const [ax, ay] = this.center(d.path[whole - 1]);
      const [bx, by] = this.center(d.path[whole]);
      pts.push(ax + (bx - ax) * frac, ay + (by - ay) * frac);
    }
    return pts.length >= 4 ? pts : null;
  }

  strokePts(pts, width, style) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.stroke();
  }

  /** Bridges: the vertical pipe passes under a small deck, the horizontal pipe runs over it. */
  drawBridges(lines, g, width) {
    const { ctx, level } = this;
    const cs = g.cell;
    for (const b of level.bridges) {
      const x = g.x + (b % this.n) * cs, y = g.y + Math.floor(b / this.n) * cs;
      const lanes = { h: [], v: [] };
      this.display.forEach((d, c) => {
        const shown = Math.ceil(Math.min(d.shown, d.path.length));
        for (let i = 1; i < shown; i++) {
          if (d.path[i] !== b || !lines[c]) continue;
          (Math.abs(d.path[i - 1] - b) === 1 ? lanes.h : lanes.v).push(c);
        }
      });
      const band = cs * 0.3;
      const cy = y + cs / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 0.5, y + 0.5, cs - 1, cs - 1);
      ctx.clip();
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y, cs, cs);
      for (const c of lanes.v) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cs, cy - band - y);
        ctx.rect(x, cy + band, cs, y + cs - cy - band);
        ctx.clip();
        this.strokePts(lines[c], width, rgba(COLORS[c].rgb));
        ctx.restore();
      }
      // the deck
      ctx.fillStyle = '#3A3A3A';
      ctx.fillRect(x, cy - band, cs, band * 2);
      ctx.fillStyle = '#9A9A9A';
      ctx.fillRect(x, cy - band, cs, Math.max(1, cs * 0.04));
      ctx.fillRect(x, cy + band - Math.max(1, cs * 0.04), cs, Math.max(1, cs * 0.04));
      for (const c of lanes.h) this.strokePts(lines[c], width, rgba(COLORS[c].rgb));
      ctx.restore();
    }
  }

  drawDot(c, cell, r) {
    const { ctx } = this;
    const [x, y] = this.center(cell);
    const col = COLORS[c].rgb;
    ctx.fillStyle = rgba(col);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    if (this.colorblind) {
      const ink = luminance(col) > 0.5 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)';
      drawSymbol(ctx, PALETTE[c].symbol, x, y, r * 0.62, ink);
    }
  }

  drawMagnifier() {
    const { mag, magCtx: m, pointer, canvas, dpr } = this;
    if (!mag || !pointer) return;
    const W = mag.width, H = mag.height;
    const zoom = 1.7;
    const sw = W / zoom, sh = H / zoom;
    const sx = pointer.px * dpr - sw / 2, sy = pointer.py * dpr - sh / 2;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, W, H);
    m.save();
    m.beginPath();
    m.arc(W / 2, H / 2, W / 2 - 2 * dpr, 0, TAU);
    m.clip();
    m.fillStyle = '#000';
    m.fillRect(0, 0, W, H);
    m.drawImage(canvas, sx, sy, sw, sh, 0, 0, W, H);
    m.restore();
    m.strokeStyle = 'rgba(255,255,255,0.9)';
    m.lineWidth = 2.5 * dpr;
    m.beginPath();
    m.arc(W / 2, H / 2, W / 2 - 2 * dpr, 0, TAU);
    m.stroke();

    // above the finger, flipped sideways near the top of the screen
    const rect = canvas.getBoundingClientRect();
    const vx = rect.left + pointer.px, vy = rect.top + pointer.py;
    const size = W / dpr;
    let left = vx - size / 2;
    let top = vy - size - 46;
    if (top < 6) {
      top = clamp(vy - size / 2, 6, window.innerHeight - size - 6);
      left = vx > window.innerWidth / 2 ? vx - size - 46 : vx + 46;
    }
    left = clamp(left, 6, window.innerWidth - size - 6);
    mag.style.transform = `translate(${left}px, ${top}px)`;
    mag.classList.add('show');
  }
}

/** Colorblind symbols, centred at (x, y), radius r. */
export function drawSymbol(ctx, sym, x, y, r, ink) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1.2, r * 0.28);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  const poly = (n, rad, rot = -Math.PI / 2) => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU;
      if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
  };
  switch (sym) {
    case 'dot':
      ctx.arc(0, 0, r * 0.45, 0, TAU);
      ctx.fill();
      break;
    case 'triangle':
      poly(3, r * 0.75);
      ctx.fill();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * TAU;
        const rad = i % 2 ? r * 0.36 : r * 0.82;
        if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
        else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'plus':
      ctx.moveTo(-r * 0.6, 0);
      ctx.lineTo(r * 0.6, 0);
      ctx.moveTo(0, -r * 0.6);
      ctx.lineTo(0, r * 0.6);
      ctx.stroke();
      break;
    case 'diamond':
      poly(4, r * 0.72);
      ctx.fill();
      break;
    case 'drop':
      ctx.moveTo(0, -r * 0.8);
      ctx.quadraticCurveTo(r * 0.65, 0, r * 0.45, r * 0.3);
      ctx.arc(0, r * 0.25, r * 0.45, 0.1, Math.PI - 0.1);
      ctx.quadraticCurveTo(-r * 0.65, 0, 0, -r * 0.8);
      ctx.fill();
      break;
    case 'square':
      ctx.rect(-r * 0.5, -r * 0.5, r, r);
      ctx.fill();
      break;
    case 'heart':
      ctx.moveTo(0, r * 0.7);
      ctx.bezierCurveTo(-r * 0.95, 0, -r * 0.55, -r * 0.8, 0, -r * 0.3);
      ctx.bezierCurveTo(r * 0.55, -r * 0.8, r * 0.95, 0, 0, r * 0.7);
      ctx.fill();
      break;
    case 'ring':
      ctx.arc(0, 0, r * 0.55, 0, TAU);
      ctx.stroke();
      break;
    case 'hexagon':
      poly(6, r * 0.68, 0);
      ctx.fill();
      break;
    case 'moon':
      ctx.arc(0, 0, r * 0.7, 0, TAU);
      ctx.arc(r * 0.32, -r * 0.2, r * 0.55, 0, TAU, true);
      ctx.fill('evenodd');
      break;
    case 'bars':
      ctx.moveTo(-r * 0.3, -r * 0.6);
      ctx.lineTo(-r * 0.3, r * 0.6);
      ctx.moveTo(r * 0.3, -r * 0.6);
      ctx.lineTo(r * 0.3, r * 0.6);
      ctx.stroke();
      break;
    default:
      break;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Win celebration: confetti in the level's colors
// ---------------------------------------------------------------------------------------------

export class Confetti {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.raf = 0;
    this.running = false;
    this.tick = this.tick.bind(this);
  }

  start(colors) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    const count = Math.min(70, Math.round((this.w * this.h) / 6000));
    const pal = colors.length ? colors : [0, 1, 2];
    this.parts = Array.from({ length: count }, (_, i) => this.spawn(pal[i % pal.length], true));
    this.running = true;
    this.last = performance.now();
    this.canvas.classList.add('show');
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  spawn(color, initial) {
    return {
      x: Math.random() * this.w,
      y: initial ? -Math.random() * this.h * 0.8 : -12,
      vy: 120 + Math.random() * 140,
      vx: (Math.random() - 0.5) * 60,
      rot: Math.random() * TAU,
      vr: (Math.random() - 0.5) * 8,
      size: 4 + Math.random() * 5,
      round: Math.random() < 0.5,
      color,
    };
  }

  stop() {
    this.running = false;
    this.canvas.classList.remove('show');
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  tick(now) {
    this.raf = 0;
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    for (const p of this.parts) {
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      p.rot += p.vr * dt;
      if (p.y > this.h + 12) Object.assign(p, this.spawn(p.color, false));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = rgba(COLORS[p.color].rgb);
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.6, 0, TAU);
        ctx.fill();
      } else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    this.raf = requestAnimationFrame(this.tick);
  }
}
