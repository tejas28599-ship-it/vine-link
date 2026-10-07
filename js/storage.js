// Vine Link — persistence. Every localStorage access is wrapped: private mode, full storage
// or disabled cookies must never break the game; it just won't remember anything.

const KEY = 'vine-link/save/v1';

function defaults() {
  return {
    settings: { sound: true, vibration: true, colorblind: false },
    progress: {
      current: 1, // next level to play
      completed: {}, // { [levelNumber]: { moves, perfect } }
    },
    inProgress: null, // { key, state }
    tutorials: {}, // { basics: true, rocks: true, ... }
    daily: {}, // { 'YYYY-MM-DD': { moves, perfect } }
  };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Overlay saved data onto defaults, keeping only values whose type matches. */
function merge(base, saved) {
  if (!isObj(saved)) return base;
  for (const k of Object.keys(saved)) {
    const v = saved[k];
    if (!(k in base)) base[k] = v; // map entries (completed levels, tutorials, daily…)
    else if (isObj(base[k])) base[k] = merge(base[k], v);
    else if (base[k] === null || typeof v === typeof base[k]) base[k] = v;
  }
  return base;
}

export function load() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaults();
    return merge(defaults(), JSON.parse(raw));
  } catch (err) {
    console.warn('[Vine Link] could not read save data', err);
    return defaults();
  }
}

export function save(data) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('[Vine Link] could not write save data', err);
    return false;
  }
}

export function reset() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return defaults();
}
