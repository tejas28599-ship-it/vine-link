import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage stand-in
const mem = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
};
const Store = await import('../js/storage.js');

test('progress, tutorials and daily records survive a save/load round trip', () => {
  const s = Store.load();
  s.progress.completed[3] = { moves: 5, perfect: true };
  s.progress.current = 4;
  s.tutorials.basics = true;
  s.daily['2026-10-07'] = { moves: 7, perfect: false };
  s.inProgress = { key: 'L4', state: { vines: [] } };
  s.settings.sound = false;
  assert.ok(Store.save(s));
  const back = Store.load();
  assert.deepEqual(back.progress.completed[3], { moves: 5, perfect: true });
  assert.equal(back.progress.current, 4);
  assert.equal(back.tutorials.basics, true);
  assert.equal(back.daily['2026-10-07'].moves, 7);
  assert.equal(back.inProgress.key, 'L4');
  assert.equal(back.settings.sound, false);
  assert.equal(back.settings.vibration, true, 'missing settings fall back to defaults');
});

test('corrupt or unavailable storage falls back to defaults', () => {
  mem.set('vine-link/save/v1', '{not json');
  assert.equal(Store.load().progress.current, 1);
  const real = window.localStorage.getItem;
  window.localStorage.getItem = () => { throw new Error('SecurityError'); };
  assert.equal(Store.load().progress.current, 1);
  window.localStorage.getItem = real;
  window.localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
  assert.equal(Store.save(Store.load()), false);
});

test('wrong-typed values are ignored', () => {
  mem.set('vine-link/save/v1', JSON.stringify({ settings: { sound: 'yes' }, progress: { current: 'x' } }));
  const s = Store.load();
  assert.equal(s.settings.sound, true);
  assert.equal(s.progress.current, 1);
});
