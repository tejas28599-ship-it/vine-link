#!/usr/bin/env node
// Draws the Vine Link app icon (two bright pipes on a black grid) as SVG + PNGs.
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
// A black tile with an olive grid, two bright pipes with round ends, and their cells tinted.
const GRID = [225, 228, 242];
const RED = [255, 0, 0], BLUE = [0, 0, 255];
const ORIGIN = 96, CELL = 320 / 3; // 3×3 grid inside the tile
const at = (c, r) => [ORIGIN + (c + 0.5) * CELL, ORIGIN + (r + 0.5) * CELL];
const PIPES = [
  { color: RED, cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
  { color: BLUE, cells: [[0, 1], [0, 2], [1, 2], [2, 2]] },
];
const HALF_WIDTH = 19, DOT = 36;

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Color at a point in design space, or null for transparent. */
function sample(x, y, { full }) {
  const r = 112;
  if (!full) {
    const qx = Math.max(Math.abs(x - 256) - (256 - r), 0), qy = Math.max(Math.abs(y - 256) - (256 - r), 0);
    if (Math.hypot(qx, qy) > r) return null;
  }
  // indigo glow behind the board
  const glow = Math.max(0, 1 - Math.hypot(x - 256, y - 40) / 520);
  let col = [16 + 43 * glow, 17 + 46 * glow, 46 + 112 * glow];
  const inGrid = x >= ORIGIN && y >= ORIGIN && x <= ORIGIN + 3 * CELL && y <= ORIGIN + 3 * CELL;
  if (inGrid) {
    col = [255, 255, 255];
    const c = Math.min(2, Math.floor((x - ORIGIN) / CELL)), rr = Math.min(2, Math.floor((y - ORIGIN) / CELL));
    for (const p of PIPES) if (p.cells.some(([pc, pr]) => pc === c && pr === rr)) col = p.color.map((v) => 255 - (255 - v) * 0.26);
    const gx = (x - ORIGIN) / CELL, gy = (y - ORIGIN) / CELL;
    const near = (v) => Math.abs(v - Math.round(v)) * CELL < 2.5;
    if (near(gx) || near(gy)) col = GRID;
  }
  for (const p of PIPES) {
    const pts = p.cells.map(([c, rr]) => at(c, rr));
    for (let i = 1; i < pts.length; i++) {
      if (segDist(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= HALF_WIDTH) col = p.color;
    }
    for (const e of [pts[0], pts[pts.length - 1]]) if (Math.hypot(x - e[0], y - e[1]) <= DOT) col = p.color;
  }
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
const rgb = (c) => `rgb(${c})`;
const lines = [];
for (let i = 0; i <= 3; i++) {
  const p = (ORIGIN + i * CELL).toFixed(1);
  lines.push(`M${p} ${ORIGIN}V${ORIGIN + 320}`, `M${ORIGIN} ${p}H${ORIGIN + 320}`);
}
const tints = PIPES.flatMap((p) => p.cells.map(([c, r]) =>
  `<rect x="${(ORIGIN + c * CELL).toFixed(1)}" y="${(ORIGIN + r * CELL).toFixed(1)}" width="${CELL.toFixed(1)}" height="${CELL.toFixed(1)}" fill="${rgb(p.color)}" opacity=".26"/>`));
const pipes = PIPES.map((p) => {
  const pts = p.cells.map(([c, r]) => at(c, r).map((v) => v.toFixed(1)).join(','));
  const [a, b] = [at(...p.cells[0]), at(...p.cells[p.cells.length - 1])];
  return `<polyline points="${pts.join(' ')}" fill="none" stroke="${rgb(p.color)}" stroke-width="${HALF_WIDTH * 2}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="${DOT}" fill="${rgb(p.color)}"/><circle cx="${b[0].toFixed(1)}" cy="${b[1].toFixed(1)}" r="${DOT}" fill="${rgb(p.color)}"/>`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><radialGradient id="bg" cx="50%" cy="8%" r="100%"><stop offset="0" stop-color="#3b3f9e"/><stop offset="1" stop-color="#10112e"/></radialGradient></defs>
<rect width="512" height="512" rx="112" fill="url(#bg)"/>
<rect x="${ORIGIN}" y="${ORIGIN}" width="320" height="320" fill="#ffffff"/>
${tints.join('')}
<path d="${lines.join('')}" stroke="${rgb(GRID)}" stroke-width="5"/>
${pipes.join('\n')}
</svg>
`;
writeFileSync(join(OUT, 'icon.svg'), svg);
console.log('wrote icon.svg');
