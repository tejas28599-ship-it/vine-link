#!/usr/bin/env node
// Draws the Vine Link app icon (a curling vine linking two flowers) as SVG + PNGs.
// No dependencies: a tiny supersampled vector rasterizer + PNG encoder (node:zlib).
//
//   node tools/make-icons.js

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

// ---- design in a 512×512 space -------------------------------------------------------------
const BG_TOP = [44, 66, 36], BG_BOTTOM = [28, 36, 23];
const VINE = [95, 174, 74], VINE_HI = [185, 236, 154], LEAF = [123, 203, 87];
const PETAL_A = [242, 84, 91], PETAL_B = [61, 125, 242], HEART = [255, 214, 107];

// Vine: cubic Bézier from the lower-left flower to the upper-right flower.
const P0 = [150, 360], P1 = [150, 190], P2 = [362, 322], P3 = [362, 152];
function bez(t) {
  const u = 1 - t;
  return [
    u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0],
    u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1],
  ];
}
const VINE_PTS = Array.from({ length: 121 }, (_, i) => bez(i / 120));
const LEAVES = [0.28, 0.5, 0.72].map((t, i) => {
  const p = bez(t), q = bez(t + 0.01);
  const ang = Math.atan2(q[1] - p[1], q[0] - p[0]) + (i % 2 ? 1 : -1) * 1.0;
  return { x: p[0] + Math.cos(ang) * 30, y: p[1] + Math.sin(ang) * 30, ang, rx: 32, ry: 14 };
});

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function vineDist(x, y, ox = 0, oy = 0) {
  let d = Infinity;
  for (let i = 1; i < VINE_PTS.length; i++) {
    const a = VINE_PTS[i - 1], b = VINE_PTS[i];
    d = Math.min(d, segDist(x, y, a[0] + ox, a[1] + oy, b[0] + ox, b[1] + oy));
  }
  return d;
}
function inEllipse(x, y, e) {
  const c = Math.cos(-e.ang), s = Math.sin(-e.ang);
  const dx = x - e.x, dy = y - e.y;
  const u = dx * c - dy * s, v = dx * s + dy * c;
  return (u * u) / (e.rx * e.rx) + (v * v) / (e.ry * e.ry) <= 1;
}
function flower(x, y, cx, cy, petal, rot) {
  const dx = x - cx, dy = y - cy;
  if (Math.hypot(dx, dy) < 26) return HEART;
  for (let k = 0; k < 5; k++) {
    const a = rot + (k / 5) * Math.PI * 2;
    if (inEllipse(x, y, { x: cx + Math.cos(a) * 42, y: cy + Math.sin(a) * 42, ang: a, rx: 40, ry: 27 })) {
      const shade = 0.85 + 0.15 * Math.min(1, Math.hypot(dx, dy) / 80);
      return petal.map((v) => Math.min(255, v * shade + 20 * (1 - shade)));
    }
  }
  return null;
}

/** Color at a point in design space, or null for transparent. */
function sample(x, y, { full }) {
  // background: rounded square (full-bleed for maskable)
  const r = 112;
  let inside = true;
  if (!full) {
    const qx = Math.max(Math.abs(x - 256) - (256 - r), 0), qy = Math.max(Math.abs(y - 256) - (256 - r), 0);
    inside = Math.hypot(qx, qy) <= r;
  }
  if (!inside) return null;
  const t = y / 512;
  let col = BG_TOP.map((v, i) => v + (BG_BOTTOM[i] - v) * t);
  // soft glow behind the vine
  const g = Math.max(0, 1 - Math.hypot(x - 256, y - 250) / 260);
  col = col.map((v, i) => v + ([255, 214, 107][i] - v) * g * g * 0.12);

  for (const e of LEAVES) if (inEllipse(x, y, e)) col = LEAF;
  const d = vineDist(x, y);
  if (d < 17) col = VINE;
  if (vineDist(x, y, -5, -6) < 4.5 && d < 15) col = VINE_HI.map((v, i) => (v + col[i]) / 2);
  const f1 = flower(x, y, P0[0], P0[1], PETAL_A, 0.3);
  if (f1) col = f1;
  const f2 = flower(x, y, P3[0], P3[1], PETAL_B, -0.2);
  if (f2) col = f2;
  return col;
}

function render(size, opts) {
  const ss = 4; // 4×4 supersampling
  const scale = opts.scale ?? 1;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          let dx = ((x + (sx + 0.5) / ss) / size) * 512;
          let dy = ((y + (sy + 0.5) / ss) / size) * 512;
          // maskable: shrink the art into the 80% safe zone, keep the background full-bleed
          const bg = opts.full ? sample(dx, dy, { full: true }) : null;
          dx = 256 + (dx - 256) / scale;
          dy = 256 + (dy - 256) / scale;
          let c = sample(dx, dy, opts);
          if (!c && bg) c = bg;
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const n = ss * ss, i = (y * size + x) * 4;
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

// ---- PNG encoding ------------------------------------------------------------------------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { full: true, scale: 0.78 }],
  ['apple-touch-icon.png', 180, { full: true, scale: 0.9 }],
  ['favicon-32.png', 32, {}],
];
for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT, name), png(size, render(size, opts)));
  console.log('wrote', name);
}

// ---- matching SVG ----------------------------------------------------------------------
const f = (n) => n.toFixed(1);
const petals = (cx, cy, col, rot) =>
  Array.from({ length: 5 }, (_, k) => {
    const a = rot + (k / 5) * Math.PI * 2;
    return `<ellipse cx="${f(cx + Math.cos(a) * 42)}" cy="${f(cy + Math.sin(a) * 42)}" rx="40" ry="27" transform="rotate(${f((a * 180) / Math.PI)} ${f(cx + Math.cos(a) * 42)} ${f(cy + Math.sin(a) * 42)})" fill="rgb(${col})"/>`;
  }).join('') + `<circle cx="${cx}" cy="${cy}" r="26" fill="rgb(${HEART})"/>`;
const path = `M${P0} C${P1} ${P2} ${P3}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${BG_TOP})"/><stop offset="1" stop-color="rgb(${BG_BOTTOM})"/></linearGradient></defs>
<rect width="512" height="512" rx="112" fill="url(#bg)"/>
${LEAVES.map((e) => `<ellipse cx="${f(e.x)}" cy="${f(e.y)}" rx="${e.rx}" ry="${e.ry}" transform="rotate(${f((e.ang * 180) / Math.PI)} ${f(e.x)} ${f(e.y)})" fill="rgb(${LEAF})"/>`).join('')}
<path d="${path}" fill="none" stroke="rgb(${VINE})" stroke-width="34" stroke-linecap="round"/>
<path d="${path}" fill="none" stroke="rgb(${VINE_HI})" stroke-width="9" stroke-linecap="round" opacity=".5" transform="translate(-5 -6)"/>
${petals(P0[0], P0[1], PETAL_A, 0.3)}
${petals(P3[0], P3[1], PETAL_B, -0.2)}
</svg>
`;
writeFileSync(join(OUT, 'icon.svg'), svg);
console.log('wrote icon.svg');
