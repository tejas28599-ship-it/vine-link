#!/usr/bin/env node
// Pre-generate the Vine Link campaign into levels.json.
//
//   node tools/generate-levels.js            # all levels, all CPU cores
//   node tools/generate-levels.js 91 120     # just a range (merged into the existing file)
//
// Every level is generated from its own seed, so the output is identical on every machine and
// identical to what the browser would generate as a fallback.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'levels.json');

if (!isMainThread) {
  const { campaignDef, toCompact } = await import('../js/levels.js');
  const { createLevel } = await import('../js/game.js');
  const { solve } = await import('../js/solver.js');
  parentPort.on('message', (n) => {
    const t = Date.now();
    const def = campaignDef(n);
    const check = solve(createLevel(def), { limit: 2, maxSteps: 5_000_000 });
    if (!check.unique) throw new Error(`Level ${n} failed the uniqueness re-check`);
    parentPort.postMessage({ n, level: toCompact(def), ms: Date.now() - t, steps: check.steps, attempts: def.meta?.attempts ?? 1 });
  });
} else {
  const { TOTAL_LEVELS } = await import('../js/levels.js');
  const from = Number(process.argv[2] || 1);
  const to = Number(process.argv[3] || TOTAL_LEVELS);
  const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).levels : [];
  const levels = existing.slice(0, TOTAL_LEVELS);
  // biggest (slowest) levels first so the pool stays busy
  const queue = [];
  for (let n = to; n >= from; n--) queue.push(n);
  const threads = Math.max(1, Math.min(cpus().length - 1, queue.length));
  const started = Date.now();
  let done = 0;

  const save = () => {
    const out = { version: 1, generated: new Date().toISOString().slice(0, 10), count: levels.filter(Boolean).length, levels };
    writeFileSync(OUT, JSON.stringify(out));
  };

  await Promise.all(
    Array.from({ length: threads }, () =>
      new Promise((resolve, reject) => {
        const w = new Worker(fileURLToPath(import.meta.url), { workerData: {} });
        const next = () => {
          const n = queue.shift();
          if (n === undefined) {
            w.terminate();
            resolve();
          } else w.postMessage(n);
        };
        w.on('message', (m) => {
          levels[m.n - 1] = m.level;
          done++;
          const size = m.level.n;
          console.log(
            `level ${String(m.n).padStart(3)}  ${size}×${size}  colors ${String(m.level.p.length).padStart(2)}  ` +
              `rocks ${(m.level.r || []).length}  bridges ${(m.level.b || []).length}  ` +
              `attempts ${String(m.attempts).padStart(3)}  ${(m.ms / 1000).toFixed(1)}s  [${done}/${to - from + 1}]`,
          );
          if (done % 10 === 0) save();
          next();
        });
        w.on('error', reject);
        next();
      }),
    ),
  );
  if (levels.length !== TOTAL_LEVELS || levels.some((l) => !l)) console.warn('Warning: some levels are missing');
  save();
  console.log(`Wrote ${OUT} in ${((Date.now() - started) / 1000).toFixed(1)}s using ${threads} threads`);
}
