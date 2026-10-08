// Vine Link — canvas renderer.
//
// Performance notes (60 fps on mid-range phones):
//   • Static soil/rocks/bridges are drawn once into an offscreen canvas and blitted.
//   • Grass tiles, sprouts and the glow blob are pre-rendered sprites.
//   • No shadowBlur anywhere; glows are wide translucent strokes or additive sprites.
//   • The rAF loop only runs while something is moving, so an idle board costs nothing.
//   • Device pixel ratio is capped at 2.

import { COLORS, PALETTE, rgba, mix } from './palette.js';
import { ROCK, BRIDGE, isComplete } from './game.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

function hash(n) {
  let x = (n | 0) * 374761393;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

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
    this.fill = 0;
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
    this.bloom = Array.from({ length: K }, () => ({ on: false, t0: -1e9, v: 0 }));
    this.cover = new Float32Array(level.cellCount);
    this.coverTarget = new Float32Array(level.cellCount);
    this.coverColor = new Int8Array(level.cellCount).fill(-1);
    this.pulses = [];
    this.celebrating = false;
    this.active = null;
    this.pointer = null;
    if (this.cssSize) this.buildStatic();
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
    if (this.level) this.buildStatic();
    this.request();
  }

  /** Board geometry in CSS pixels (used by input). */
  geom() {
    const pad = Math.round(this.cssSize * 0.022);
    const cell = (this.cssSize - pad * 2) / (this.n || 1);
    return { x: pad, y: pad, cell, size: this.n || 1 };
  }

  center(cell) {
    const g = this.geom();
    const r = Math.floor(cell / this.n), c = cell % this.n;
    return [g.x + (c + 0.5) * g.cell, g.y + (r + 0.5) * g.cell];
  }

  // ------------------------------------------------------------------------------------------
  // Static layers and sprites
  // ------------------------------------------------------------------------------------------

  buildStatic() {
    const { level, dpr } = this;
    const S = this.cssSize * dpr;
    const g = this.geom();
    const cs = g.cell * dpr;
    const ox = g.x * dpr, oy = g.y * dpr;
    const bg = makeCanvas(S, S);
    const ctx = bg.getContext('2d');

    // board bed
    const bedGrad = ctx.createLinearGradient(0, 0, 0, S);
    bedGrad.addColorStop(0, '#0d0b09');
    bedGrad.addColorStop(1, '#080706');
    ctx.fillStyle = bedGrad;
    roundRect(ctx, 0, 0, S, S, S * 0.04);
    ctx.fill();

    const inset = Math.max(1, cs * 0.045);
    const rad = cs * 0.2;
    for (let cell = 0; cell < level.cellCount; cell++) {
      const r = Math.floor(cell / this.n), c = cell % this.n;
      const x = ox + c * cs, y = oy + r * cs;
      const h = hash(cell * 7 + level.size);
      const kind = level.kind[cell];
      // soil tile
      // dark soil so the bright vine colors stand out
      const base = kind === ROCK ? [14, 12, 10] : mix([30, 25, 21], [26, 22, 19], h);
      const tg = ctx.createLinearGradient(x, y, x, y + cs);
      tg.addColorStop(0, rgba(mix(base, [255, 230, 200], 0.06)));
      tg.addColorStop(1, rgba(mix(base, [0, 0, 0], 0.1)));
      ctx.fillStyle = tg;
      roundRect(ctx, x + inset, y + inset, cs - inset * 2, cs - inset * 2, rad);
      ctx.fill();
      // pebbles / crumbs
      for (let k = 0; k < 4; k++) {
        const hx = hash(cell * 31 + k * 7), hy = hash(cell * 17 + k * 13), hs = hash(cell * 5 + k);
        ctx.fillStyle = hs > 0.5 ? 'rgba(255,235,210,0.07)' : 'rgba(0,0,0,0.12)';
        ctx.beginPath();
        ctx.arc(x + cs * (0.2 + hx * 0.6), y + cs * (0.2 + hy * 0.6), cs * (0.025 + hs * 0.03), 0, TAU);
        ctx.fill();
      }
      if (kind === ROCK) this.drawRock(ctx, x, y, cs, cell);
      if (kind === BRIDGE) this.drawBridge(ctx, x, y, cs);
    }
    this.bg = bg;

    // grass tile sprites (3 variants)
    this.grass = [0, 1, 2].map((v) => {
      const t = makeCanvas(cs, cs);
      const c2 = t.getContext('2d');
      const gg = c2.createLinearGradient(0, 0, 0, cs);
      gg.addColorStop(0, '#4f7f3c');
      gg.addColorStop(1, '#3b6530');
      c2.fillStyle = gg;
      roundRect(c2, inset, inset, cs - inset * 2, cs - inset * 2, rad);
      c2.fill();
      c2.save();
      roundRect(c2, inset, inset, cs - inset * 2, cs - inset * 2, rad);
      c2.clip();
      c2.lineCap = 'round';
      for (let k = 0; k < 16; k++) {
        const bx = hash(v * 97 + k * 3) * cs, by = hash(v * 53 + k * 11) * cs;
        const bl = cs * (0.08 + hash(v * 7 + k) * 0.1);
        const lean = (hash(v * 13 + k * 5) - 0.5) * cs * 0.08;
        c2.strokeStyle = hash(k + v) > 0.5 ? 'rgba(140,200,100,0.45)' : 'rgba(30,60,25,0.35)';
        c2.lineWidth = Math.max(1, cs * 0.025);
        c2.beginPath();
        c2.moveTo(bx, by);
        c2.quadraticCurveTo(bx + lean * 0.3, by - bl * 0.6, bx + lean, by - bl);
        c2.stroke();
      }
      c2.restore();
      return t;
    });

    // sprout sprite for empty soil as the garden fills
    const sp = makeCanvas(cs * 0.5, cs * 0.5);
    const s2 = sp.getContext('2d');
    const m = cs * 0.25;
    s2.strokeStyle = '#7fb85a';
    s2.lineWidth = Math.max(1, cs * 0.03);
    s2.lineCap = 'round';
    s2.beginPath();
    s2.moveTo(m, m * 1.7);
    s2.quadraticCurveTo(m * 1.05, m * 1.2, m, m * 0.9);
    s2.stroke();
    s2.fillStyle = '#8fcb63';
    for (const side of [-1, 1]) {
      s2.save();
      s2.translate(m, m * 1.0);
      s2.rotate(side * 0.9);
      s2.beginPath();
      s2.ellipse(0, -m * 0.32, m * 0.16, m * 0.34, 0, 0, TAU);
      s2.fill();
      s2.restore();
    }
    this.sprout = sp;

    // additive glow blob
    const gs = Math.ceil(cs * 1.6);
    const gl = makeCanvas(gs, gs);
    const g2 = gl.getContext('2d');
    const rg = g2.createRadialGradient(gs / 2, gs / 2, 0, gs / 2, gs / 2, gs / 2);
    rg.addColorStop(0, 'rgba(255,255,230,0.95)');
    rg.addColorStop(0.35, 'rgba(255,250,200,0.35)');
    rg.addColorStop(1, 'rgba(255,250,200,0)');
    g2.fillStyle = rg;
    g2.fillRect(0, 0, gs, gs);
    this.glow = gl;
  }

  drawRock(ctx, x, y, cs, cell) {
    const cx = x + cs / 2, cy = y + cs / 2 + cs * 0.03;
    const pts = 9;
    ctx.beginPath();
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * TAU;
      const r = cs * (0.33 + hash(cell * 11 + (i % pts)) * 0.08);
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r * 0.86;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const rg = ctx.createRadialGradient(cx - cs * 0.12, cy - cs * 0.15, cs * 0.05, cx, cy, cs * 0.45);
    rg.addColorStop(0, '#a7a294');
    rg.addColorStop(1, '#5b574e');
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,16,12,0.45)';
    ctx.lineWidth = Math.max(1, cs * 0.03);
    ctx.stroke();
    // moss
    ctx.fillStyle = 'rgba(120,170,80,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx + cs * 0.1, cy - cs * 0.2, cs * 0.12, cs * 0.05, -0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(cx - cs * 0.12, cy - cs * 0.1, cs * 0.07, cs * 0.04, -0.6, 0, TAU);
    ctx.fill();
  }

  drawBridge(ctx, x, y, cs) {
    const band = cs * 0.46;
    const plank = (vertical) => {
      ctx.save();
      ctx.translate(x + cs / 2, y + cs / 2);
      if (vertical) ctx.rotate(Math.PI / 2);
      ctx.fillStyle = vertical ? '#7a5634' : '#a0744a';
      roundRect(ctx, -cs * 0.5, -band / 2, cs, band, cs * 0.05);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,25,12,0.55)';
      ctx.lineWidth = Math.max(1, cs * 0.02);
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.moveTo(k * cs * 0.18, -band / 2);
        ctx.lineTo(k * cs * 0.18, band / 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,230,190,0.22)';
      ctx.fillRect(-cs * 0.5, -band / 2, cs, cs * 0.04);
      ctx.restore();
    };
    plank(true);
    plank(false);
  }

  // ------------------------------------------------------------------------------------------
  // State → animation targets
  // ------------------------------------------------------------------------------------------

  setState(state, { instant = false, fill = null } = {}) {
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
        // different route: retract to the fork, then grow the new branch
        d.path = next;
        d.shown = Math.min(d.shown, k);
        d.target = next.length;
        d.pending = null;
      }
      const done = isComplete(level, c, next);
      const b = this.bloom[c];
      if (done && !b.on) {
        b.on = true;
        b.t0 = instant ? now - 5000 : now;
        if (!instant) this.pulses.push({ color: c, t0: now });
      } else if (!done && b.on) {
        b.on = false;
        b.t0 = instant ? now - 5000 : now;
      }
      if (next.length > 1) for (const cell of next) {
        this.coverTarget[cell] = 1;
        this.coverColor[cell] = c;
      }
    }
    if (instant) this.cover.set(this.coverTarget);
    if (fill !== null) this.fill = fill;
    this.request();
  }

  /** Extra glow sweep along a vine (used for hints). */
  pulse(color) {
    this.pulses.push({ color, t0: performance.now() });
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
    let busy = this.step(dt, now);
    this.draw(now);
    if (this.pointer) this.drawMagnifier();
    busy = busy || this.celebrating || !!this.pointer;
    if (busy) this.request();
    else this.lastT = 0;
  }

  step(dt, now) {
    let busy = false;
    for (const d of this.display) {
      const diff = d.target - d.shown;
      if (Math.abs(diff) > 0.001) {
        const speed = diff < 0 ? 26 : 16; // retract a bit faster than growth
        const stepAmt = Math.max(Math.abs(diff) * dt * 14, dt * speed * 0.35);
        d.shown = Math.abs(diff) <= stepAmt || this.reduceMotion ? d.target : d.shown + Math.sign(diff) * stepAmt;
        busy = true;
      } else if (d.pending) {
        d.path = d.pending;
        d.pending = null;
        d.shown = d.target = d.path.length;
      }
    }
    for (let i = 0; i < this.cover.length; i++) {
      const diff = this.coverTarget[i] - this.cover[i];
      if (Math.abs(diff) > 0.005) {
        this.cover[i] += diff * Math.min(1, dt * 9);
        busy = true;
      } else this.cover[i] = this.coverTarget[i];
    }
    for (const b of this.bloom) if (now - b.t0 < 900) busy = true;
    this.pulses = this.pulses.filter((p) => now - p.t0 < 950);
    if (this.pulses.length) busy = true;
    return busy;
  }

  // ------------------------------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------------------------------

  draw(now) {
    const { ctx, level, dpr } = this;
    if (!level || !this.bg) return;
    const g = this.geom();
    const cs = g.cell;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // grass on planted cells, sprouts on bare soil as the garden fills
    for (let cell = 0; cell < level.cellCount; cell++) {
      if (level.kind[cell] === ROCK) continue;
      const x = g.x + (cell % this.n) * cs, y = g.y + Math.floor(cell / this.n) * cs;
      const a = this.cover[cell];
      if (a > 0.01 && level.kind[cell] !== BRIDGE) {
        ctx.globalAlpha = a * 0.18; // a hint of grass; the vine color stays dominant
        ctx.drawImage(this.grass[cell % 3], x, y, cs, cs);
        const col = this.coverColor[cell];
        if (col >= 0) {
          ctx.globalAlpha = a * 0.3;
          ctx.fillStyle = rgba(COLORS[col].flower);
          roundRect(ctx, x + cs * 0.045, y + cs * 0.045, cs * 0.91, cs * 0.91, cs * 0.2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (a < 0.99 && level.seedColor[cell] < 0 && level.kind[cell] === 0) {
        const h = hash(cell * 13 + 5);
        if (this.fill > h * 95 + 3) {
          ctx.globalAlpha = (1 - a) * clamp((this.fill - (h * 95 + 3)) / 15, 0, 0.8);
          const ox = (hash(cell * 3) - 0.5) * cs * 0.35, oy = (hash(cell * 9) - 0.5) * cs * 0.3;
          ctx.drawImage(this.sprout, x + cs * 0.25 + ox, y + cs * 0.25 + oy, cs * 0.5, cs * 0.5);
          ctx.globalAlpha = 1;
        }
      }
    }

    // active vine: soft halo under the finger's cell
    if (this.active && this.active.head >= 0) {
      const [hx, hy] = this.center(this.active.head);
      ctx.fillStyle = rgba(COLORS[this.active.color].flower, 0.22);
      ctx.beginPath();
      ctx.arc(hx, hy, cs * 0.48, 0, TAU);
      ctx.fill();
    }

    // vines
    const geoms = this.display.map((d, c) => this.vineGeometry(c, d, cs));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let c = 0; c < geoms.length; c++) {
      const v = geoms[c];
      if (!v) continue;
      const boost = this.pulseBoost(c, now);
      this.strokePts(v.pts, cs * 0.7, rgba(COLORS[c].flower, 0.2 + boost * 0.3));
    }
    for (let c = 0; c < geoms.length; c++) {
      const v = geoms[c];
      if (!v) continue;
      this.strokePts(v.pts, cs * 0.38, rgba(COLORS[c].vine));
      ctx.save();
      ctx.translate(-cs * 0.035, -cs * 0.035);
      this.strokePts(v.pts, cs * 0.07, rgba(COLORS[c].light, 0.3));
      ctx.restore();
      this.drawLeaves(c, v, cs, now);
    }

    if (level.bridges.length) this.drawBridgeCrossings(geoms, cs);

    // seeds and flowers
    for (let c = 0; c < level.pairs.length; c++) {
      const { a, b } = level.pairs[c];
      const bl = this.bloom[c];
      const t = clamp((now - bl.t0) / 650, 0, 1);
      bl.v = bl.on ? (this.reduceMotion ? 1 : easeOutBack(t)) : 1 - clamp((now - bl.t0) / 200, 0, 1);
      for (const [i, cell] of [a, b].entries()) this.drawSeed(c, cell, bl.v, cs, now, i);
    }

    // glow pulses along freshly connected vines
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pulses) {
      const v = geoms[p.color];
      if (!v || v.pts.length < 2) continue;
      const t = clamp((now - p.t0) / 900, 0, 1);
      const idx = Math.floor(easeInOut(t) * (v.pts.length / 2 - 1)) * 2;
      const gs = cs * 1.5;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.drawImage(this.glow, v.pts[idx] - gs / 2, v.pts[idx + 1] - gs / 2, gs, gs);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Make crossings readable: the vertical vine dips under the wooden deck, the horizontal vine
   * runs across on top of it.
   */
  drawBridgeCrossings(geoms, cs) {
    const { ctx, level, dpr } = this;
    const g = this.geom();
    for (const b of level.bridges) {
      const x = g.x + (b % this.n) * cs, y = g.y + Math.floor(b / this.n) * cs;
      const lanes = { h: [], v: [] };
      this.display.forEach((d, c) => {
        const shown = Math.ceil(Math.min(d.shown, d.path.length));
        for (let i = 1; i < shown; i++) {
          if (d.path[i] !== b || !geoms[c]) continue;
          (Math.abs(d.path[i - 1] - b) === 1 ? lanes.h : lanes.v).push(c);
        }
      });
      if (!lanes.h.length && !lanes.v.length) continue;
      const band = cs * 0.23;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cs, cs);
      ctx.clip();
      // restore the bare bridge, then layer: vertical vine (outside the deck) → deck → horizontal vine
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bg, x * dpr, y * dpr, cs * dpr, cs * dpr, x * dpr, y * dpr, cs * dpr, cs * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cy = y + cs / 2;
      for (const c of lanes.v) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cs, cy - band - y);
        ctx.rect(x, cy + band, cs, y + cs - cy - band);
        ctx.clip();
        this.strokePts(geoms[c].pts, cs * 0.38, rgba(COLORS[c].vine));
        ctx.restore();
        // shadow where the vine slips under the deck
        ctx.fillStyle = 'rgba(20,12,6,0.35)';
        ctx.fillRect(x + cs * 0.3, cy - band - cs * 0.04, cs * 0.4, cs * 0.04);
      }
      for (const c of lanes.h) {
        this.strokePts(geoms[c].pts, cs * 0.38, rgba(COLORS[c].vine));
        ctx.save();
        ctx.translate(-cs * 0.035, -cs * 0.035);
        this.strokePts(geoms[c].pts, cs * 0.07, rgba(COLORS[c].light, 0.3));
        ctx.restore();
      }
      ctx.restore();
    }
  }

  pulseBoost(c, now) {
    let b = 0;
    for (const p of this.pulses) if (p.color === c) b = Math.max(b, 1 - (now - p.t0) / 950);
    return b;
  }

  /** Smooth centerline: straight halves at the ends, quadratic curves through each cell. */
  vineGeometry(c, d, cs) {
    const L = d.path.length;
    const shown = Math.min(d.shown, L);
    if (L < 2 || shown <= 1.001) return null;
    const P = d.path.map((cell) => this.center(cell));
    const sEnd = shown - 1;
    const at = (s) => {
      if (s <= 0.5) {
        const t = s / 0.5;
        return [P[0][0] + (P[1][0] - P[0][0]) * 0.5 * t, P[0][1] + (P[1][1] - P[0][1]) * 0.5 * t];
      }
      if (s >= L - 1.5) {
        const t = (s - (L - 1.5)) / 0.5;
        const a = P[L - 2], b = P[L - 1];
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        return [mx + (b[0] - mx) * t, my + (b[1] - my) * t];
      }
      const i = Math.round(s);
      const t = s - (i - 0.5);
      const a = P[i - 1], m = P[i], b = P[i + 1];
      const p0x = (a[0] + m[0]) / 2, p0y = (a[1] + m[1]) / 2;
      const p2x = (m[0] + b[0]) / 2, p2y = (m[1] + b[1]) / 2;
      const u = 1 - t;
      return [u * u * p0x + 2 * u * t * m[0] + t * t * p2x, u * u * p0y + 2 * u * t * m[1] + t * t * p2y];
    };
    const step = 0.2;
    const pts = [];
    const phase = c * 1.7;
    const amp = this.reduceMotion ? 0 : cs * 0.05;
    const samples = [];
    for (let s = 0; s < sEnd; s += step) samples.push(s);
    samples.push(sEnd);
    for (const s of samples) {
      const p = at(s);
      const q = at(Math.min(sEnd, s + 0.05));
      const o = at(Math.max(0, s - 0.05));
      let tx = q[0] - o[0], ty = q[1] - o[1];
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      const taper = clamp(Math.min(s, sEnd - s) / 0.7, 0, 1);
      const off = amp * taper * Math.sin(s * 2.6 + phase);
      pts.push(p[0] - ty * off, p[1] + tx * off);
    }
    return { pts, at, sEnd, complete: isComplete(this.level, c, d.path) && shown >= L - 0.01 };
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

  drawLeaves(c, v, cs, now) {
    const { ctx } = this;
    const col = rgba(COLORS[c].leaf);
    const vein = rgba(mix(COLORS[c].leaf, [20, 40, 10], 0.4), 0.6);
    let side = 1;
    for (let s = 0.8; s < v.sEnd - 0.3; s += 0.95) {
      side = -side;
      const grow = clamp((v.sEnd - s) / 0.7, 0, 1);
      if (grow <= 0.02) continue;
      const p = v.at(s), q = v.at(Math.min(v.sEnd, s + 0.05));
      const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const sway = this.celebrating ? Math.sin(now / 380 + s * 1.3 + c) * 0.3 : 0;
      const L = cs * 0.25 * grow;
      ctx.save();
      ctx.translate(p[0], p[1]);
      ctx.rotate(ang + side * (0.95 + sway));
      ctx.translate(cs * 0.1, 0);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(L * 0.5, L * 0.42, L, 0);
      ctx.quadraticCurveTo(L * 0.5, -L * 0.42, 0, 0);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = vein;
      ctx.lineWidth = Math.max(0.6, cs * 0.012);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(L * 0.85, 0);
      ctx.stroke();
      ctx.restore();
    }
    if (!v.complete) {
      // growing bud at the tip
      const tip = v.at(v.sEnd);
      ctx.fillStyle = rgba(COLORS[c].light);
      ctx.beginPath();
      ctx.arc(tip[0], tip[1], cs * 0.1, 0, TAU);
      ctx.fill();
    }
  }

  drawSeed(c, cell, bloom, cs, now, which) {
    const { ctx } = this;
    const [x, y] = this.center(cell);
    const col = COLORS[c];
    const info = PALETTE[c];
    const sway = this.celebrating ? Math.sin(now / 520 + c * 0.9 + which * 2) * 0.22 : 0;
    const breathe = this.celebrating ? 1 + Math.sin(now / 430 + c) * 0.04 : 1;

    if (bloom > 0.01) {
      const count = this.colorblind ? info.petals : 5;
      const shape = this.colorblind ? info.shape : 'round';
      const len = cs * 0.5 * bloom * breathe;
      const wid = cs * (count > 7 ? 0.12 : count < 5 ? 0.24 : 0.19) * bloom;
      const rot = c * 0.6 + which * 0.4 + sway;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      for (let i = 0; i < count; i++) {
        ctx.save();
        ctx.rotate((i / count) * TAU);
        this.petalPath(shape, len, wid);
        const pg = ctx.createLinearGradient(0, 0, len, 0);
        pg.addColorStop(0, rgba(col.flower));
        pg.addColorStop(0.6, rgba(col.flower));
        pg.addColorStop(1, rgba(col.light));
        ctx.fillStyle = pg;
        ctx.fill();
        ctx.strokeStyle = rgba(col.dark, 0.25);
        ctx.lineWidth = Math.max(0.6, cs * 0.015);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }

    // seed / flower heart
    const r = cs * (0.34 - 0.13 * clamp(bloom, 0, 1));
    const heart = bloom > 0.01 ? mix(col.flower, [255, 230, 140], 0.3 * clamp(bloom, 0, 1)) : col.flower;
    const sg = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    sg.addColorStop(0, rgba(mix(heart, [255, 255, 255], 0.45)));
    sg.addColorStop(1, rgba(heart));
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(col.dark, 0.45);
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.stroke();
    // light outer ring: keeps dark seeds (purple, blue) visible on dark soil
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, cs * 0.025);
    ctx.beginPath();
    ctx.arc(x, y, r + Math.max(1, cs * 0.03), 0, TAU);
    ctx.stroke();

    if (this.colorblind) {
      const ink = luminance(heart) > 0.55 ? 'rgba(35,24,14,0.85)' : 'rgba(255,250,240,0.92)';
      drawSymbol(ctx, info.symbol, x, y, Math.max(r * 0.62, cs * 0.1), ink);
    }
  }

  petalPath(shape, len, w) {
    const { ctx } = this;
    ctx.beginPath();
    if (shape === 'pointed') {
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.45, w * 1.1, len, 0);
      ctx.quadraticCurveTo(len * 0.45, -w * 1.1, 0, 0);
    } else if (shape === 'heart') {
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(len * 0.25, w * 1.2, len * 1.05, w * 1.1, len * 0.95, w * 0.15);
      ctx.lineTo(len * 0.8, 0);
      ctx.lineTo(len * 0.95, -w * 0.15);
      ctx.bezierCurveTo(len * 1.05, -w * 1.1, len * 0.25, -w * 1.2, 0, 0);
    } else if (shape === 'thin') {
      ctx.ellipse(len * 0.55, 0, len * 0.47, w * 0.42, 0, 0, TAU);
    } else {
      ctx.ellipse(len * 0.55, 0, len * 0.47, w * 0.62, 0, 0, TAU);
    }
    ctx.closePath();
  }

  drawMagnifier() {
    const { mag, magCtx: m, pointer, canvas, dpr } = this;
    if (!mag || !pointer) return;
    const W = mag.width, H = mag.height;
    const zoom = 1.7;
    const sw = (W / zoom), sh = (H / zoom);
    const sx = pointer.px * dpr - sw / 2, sy = pointer.py * dpr - sh / 2;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, W, H);
    m.save();
    m.beginPath();
    m.arc(W / 2, H / 2, W / 2 - 2 * dpr, 0, TAU);
    m.clip();
    m.fillStyle = '#2a1f17';
    m.fillRect(0, 0, W, H);
    m.drawImage(canvas, sx, sy, sw, sh, 0, 0, W, H);
    m.restore();
    m.strokeStyle = 'rgba(255,248,230,0.85)';
    m.lineWidth = 2.5 * dpr;
    m.beginPath();
    m.arc(W / 2, H / 2, W / 2 - 2 * dpr, 0, TAU);
    m.stroke();
    m.fillStyle = 'rgba(255,248,230,0.9)';
    m.beginPath();
    m.arc(W / 2, H / 2, 2.2 * dpr, 0, TAU);
    m.fill();

    // position: above the finger, flipped sideways near the top of the screen
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
// Win celebration: petals drifting across the whole screen
// ---------------------------------------------------------------------------------------------

export class PetalShower {
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
    const count = Math.min(48, Math.round((this.w * this.h) / 9000));
    const pal = colors.length ? colors : [0, 2, 7];
    this.parts = Array.from({ length: count }, (_, i) => this.spawn(pal[i % pal.length], true));
    this.pal = pal;
    this.running = true;
    this.t0 = performance.now();
    this.last = this.t0;
    this.canvas.classList.add('show');
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  spawn(color, initial) {
    return {
      x: Math.random() * this.w * 1.2 - this.w * 0.1,
      y: initial ? -Math.random() * this.h : -20,
      vy: 28 + Math.random() * 40,
      vx: 12 + Math.random() * 22,
      rot: Math.random() * TAU,
      vr: (Math.random() - 0.5) * 2.5,
      size: 6 + Math.random() * 7,
      phase: Math.random() * TAU,
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
      p.x += (p.vx + Math.sin(now / 700 + p.phase) * 30) * dt;
      p.rot += p.vr * dt;
      if (p.y > this.h + 20 || p.x > this.w + 30) Object.assign(p, this.spawn(p.color, false));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(now / 300 + p.phase)));
      ctx.fillStyle = rgba(COLORS[p.color].light, 0.9);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(COLORS[p.color].flower, 0.8);
      ctx.beginPath();
      ctx.ellipse(-p.size * 0.25, 0, p.size * 0.55, p.size * 0.3, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    this.raf = requestAnimationFrame(this.tick);
  }
}
