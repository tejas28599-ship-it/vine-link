// Vine Link — app shell: screens, HUD, and the glue between rules, input, renderer and audio.

import * as G from './game.js';
import * as Levels from './levels.js';
import { BoardRenderer, PetalShower } from './render.js';
import { attachInput } from './input.js';
import * as Sound from './audio.js';
import * as Store from './storage.js';

const $ = (id) => document.getElementById(id);
const AUTO_ADVANCE_MS = 4000;

const TUTORIALS = {
  basics: {
    title: 'Grow your garden',
    text: 'Drag from a seed to its matching seed to grow a vine. Link every pair and cover every patch of soil to make the garden bloom.',
    art: 'basics',
  },
  hints: {
    title: 'The watering can',
    text: 'Stuck? Tap the watering can and one correct vine grows by itself. You get 3 per garden, and undo won’t give them back.',
    art: 'hints',
  },
  rocks: {
    title: 'Rocks',
    text: 'Vines can’t grow through rocks. Plan your routes around them. Rocks don’t need to be covered.',
    art: 'rocks',
  },
  bridges: {
    title: 'Bridges',
    text: 'A bridge carries two vines: one crosses left–right, the other top–bottom. Vines go straight across a bridge, and both lanes must be filled.',
    art: 'bridges',
  },
  daily: {
    title: 'Daily Garden',
    text: 'A fresh garden every day, the same one for every gardener. Come back tomorrow for a new one.',
    art: 'daily',
  },
};

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

let save = Store.load();
const app = {
  screen: 'home',
  mode: 'campaign', // or 'daily'
  levelNo: 1,
  dailyKey: null,
  key: null,
  level: null,
  state: null,
  drag: null,
  won: false,
  autoTimer: 0,
  autoStart: 0,
  pack: 0,
};

const board = new BoardRenderer($('board'), $('magnifier'));
const petals = new PetalShower($('petals'));
board.setColorblind(save.settings.colorblind);
Sound.setEnabled(save.settings.sound);

function persist() {
  Store.save(save);
}

function highestUnlocked() {
  let top = 0;
  for (const k of Object.keys(save.progress.completed)) top = Math.max(top, Number(k));
  return Math.min(Levels.TOTAL_LEVELS, Math.max(1, top + 1, save.progress.current || 1));
}

function isUnlocked(n) {
  return n <= highestUnlocked() || !!save.progress.completed[n];
}

// ---------------------------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------------------------

function show(screen) {
  app.screen = screen;
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('active', el.id === `screen-${screen}`);
  if (screen === 'home') renderHome();
  if (screen === 'levels') renderLevels();
  if (screen === 'game') {
    layout(); // synchronous: the board must have a size before the first pointer event
    requestAnimationFrame(layout);
  }
}

function renderHome() {
  const n = Math.min(save.progress.current || 1, Levels.TOTAL_LEVELS);
  const pack = Levels.PACKS[Levels.packOf(n)];
  $('home-level').textContent = `Level ${n} · ${pack.name}`;
  const done = Object.keys(save.progress.completed).length;
  const perfect = Object.values(save.progress.completed).filter((c) => c.perfect).length;
  $('home-progress').textContent = done
    ? `${done} of ${Levels.TOTAL_LEVELS} gardens grown · ${perfect} perfect`
    : 'Cozy puzzles, one vine at a time';
  $('daily-dot').hidden = !!save.daily[Levels.dateKey()];
}

function renderLevels() {
  const tabs = $('pack-tabs');
  tabs.innerHTML = '';
  Levels.PACKS.forEach((p, i) => {
    const first = i * Levels.LEVELS_PER_PACK + 1;
    const b = document.createElement('button');
    b.className = 'pack-tab' + (isUnlocked(first) ? '' : ' locked');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === app.pack));
    let done = 0;
    for (let n = first; n < first + Levels.LEVELS_PER_PACK; n++) if (save.progress.completed[n]) done++;
    b.innerHTML = `${p.name}<small>${done}/${Levels.LEVELS_PER_PACK}</small>`;
    b.addEventListener('click', () => {
      app.pack = i;
      Sound.tap();
      renderLevels();
    });
    tabs.appendChild(b);
  });
  const pack = Levels.PACKS[app.pack];
  $('pack-blurb').textContent = `${pack.blurb}`;
  const grid = $('level-grid');
  grid.innerHTML = '';
  const first = app.pack * Levels.LEVELS_PER_PACK + 1;
  const current = save.progress.current;
  for (let n = first; n < first + Levels.LEVELS_PER_PACK; n++) {
    const b = document.createElement('button');
    const rec = save.progress.completed[n];
    const unlocked = isUnlocked(n);
    b.className = 'lvl' + (rec ? ' done' : '') + (unlocked ? '' : ' locked') + (n === current ? ' current' : '');
    b.setAttribute('aria-label', `Level ${n}${rec ? ', completed' : ''}${rec?.perfect ? ', perfect' : ''}${unlocked ? '' : ', locked'}`);
    b.innerHTML = unlocked ? `${n}${rec?.perfect ? '<svg class="leaf"><use href="#i-leaf"/></svg>' : ''}` : '<svg><use href="#i-lock"/></svg>';
    if (unlocked) b.addEventListener('click', () => { Sound.tap(); startLevel(n); });
    else b.disabled = true;
    grid.appendChild(b);
  }
}

// ---------------------------------------------------------------------------------------------
// Starting levels
// ---------------------------------------------------------------------------------------------

function loadInto(level, key) {
  input.cancel();
  hideWin();
  app.level = level;
  app.key = key;
  app.won = false;
  app.drag = null;
  let state = null;
  if (save.inProgress && save.inProgress.key === key) state = G.restoreState(level, save.inProgress.state);
  app.state = state || G.newGame(level);
  board.setLevel(level, app.state);
  updateHud(app.state);
  show('game');
  // A restored level might already be finished (closed during the win animation).
  if (G.isSolved(level, app.state)) setTimeout(win, 300);
}

function startLevel(n) {
  n = Math.max(1, Math.min(Levels.TOTAL_LEVELS, n));
  app.mode = 'campaign';
  app.levelNo = n;
  const def = Levels.getLevelDef(n);
  const level = Levels.buildLevel(def, `L${n}`);
  // "Play" continues from the furthest level reached; replaying old levels doesn't move it back.
  if (n > (save.progress.current || 1)) save.progress.current = n;
  persist();
  $('level-title').textContent = `Level ${n}`;
  $('level-pack').textContent = `${Levels.PACKS[Levels.packOf(n)].name} · ${level.size}×${level.size}`;
  loadInto(level, `L${n}`);
  queueTutorials(level, n);
}

function startDaily() {
  const key = Levels.dateKey();
  app.mode = 'daily';
  app.dailyKey = key;
  $('level-title').textContent = 'Daily Garden';
  $('level-pack').textContent = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  show('game');
  $('loading').hidden = false;
  $('board').style.visibility = 'hidden';
  // let the loading message paint before generating
  setTimeout(() => {
    let def;
    try {
      def = Levels.dailyDef(key);
    } catch (err) {
      console.error(err);
      toast('Today’s garden didn’t sprout. Try again!');
      show('home');
      return;
    } finally {
      $('loading').hidden = true;
      $('board').style.visibility = '';
    }
    const level = Levels.buildLevel(def, `D${key}`);
    $('level-pack').textContent += ` · ${level.size}×${level.size}`;
    loadInto(level, `D${key}`);
    queueTutorials(level, 0);
  }, 40);
}

// ---------------------------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------------------------

function updateHud(view) {
  const { level } = app;
  const st = G.getStats(level, view);
  $('moves').textContent = String(app.state.moves);
  $('pairs').textContent = `${st.connected}/${st.pairs}`;
  $('filled').textContent = `${st.percent}%`;
  $('filled-bar').style.width = `${st.percent}%`;
  const left = G.MAX_HINTS - app.state.hintsUsed;
  $('hint-count').textContent = String(left);
  $('btn-hint').classList.toggle('empty', left <= 0);
  $('btn-undo').disabled = app.state.history.length === 0;
  return st;
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function layout() {
  const wrap = $('board-wrap');
  const style = getComputedStyle(wrap);
  const w = wrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const h = wrap.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const size = Math.max(160, Math.floor(Math.min(w, h, 720)));
  board.resize(size);
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

function cellAt(p) {
  const n = app.level.size;
  if (p.gx < 0 || p.gy < 0 || p.gx >= n || p.gy >= n) return -1;
  return Math.floor(p.gy) * n + Math.floor(p.gx);
}

/**
 * On small screens big grids have cells under 44px, so a press that lands on empty soil snaps to
 * the nearest seed or vine tip within ~22px. Starting points get a 44px target on every grid.
 */
function startAt(p) {
  const { level, state } = app;
  const cell = cellAt(p);
  const direct = cell >= 0 ? G.startDrag(level, state, cell) : null;
  if (direct) return { drag: direct, cell };
  const g = board.geom();
  const reach = Math.max(0.5, 22 / g.cell); // 22px radius = 44px target
  let best = null;
  let bestD = Infinity;
  const consider = (c) => {
    const cx = (c % level.size) + 0.5, cy = Math.floor(c / level.size) + 0.5;
    const d = Math.hypot(cx - p.gx, cy - p.gy);
    if (d < reach && d < bestD) { bestD = d; best = c; }
  };
  level.pairs.forEach(({ a, b }) => { consider(a); consider(b); });
  state.vines.forEach((v) => { if (v.length > 1) consider(v[v.length - 1]); });
  if (best === null) return null;
  const drag = G.startDrag(level, state, best);
  return drag ? { drag, cell: best } : null;
}

const input = attachInput($('board'), () => board.geom(), {
  down(p) {
    if (!app.level || app.won) return;
    Sound.unlock();
    const hit = startAt(p);
    if (!hit) return;
    app.drag = {
      color: hit.drag.color,
      path: hit.drag.path,
      base: app.state,
      origin: hit.cell,
      moved: false,
      view: app.state,
      complete: G.isComplete(app.level, hit.drag.color, hit.drag.path),
    };
    preview();
    board.setPointer(p);
  },
  cell(cell) {
    const d = app.drag;
    if (!d) return;
    const next = stepToward(d, cell);
    if (next === d.path) return;
    d.moved = true;
    if (next.length > d.path.length) Sound.drawTone(next.length);
    d.path = next;
    preview();
  },
  move(p) {
    if (app.drag) board.setPointer(p);
  },
  up(p, cancelled) {
    const d = app.drag;
    if (!d) return;
    app.drag = null;
    board.setPointer(null);
    board.setActive(null);
    const { level } = app;
    let next;
    if (!d.moved && !cancelled && level.seedColor[d.origin] === d.color) {
      next = G.clearVine(level, d.base, d.color); // tap a seed → clear its vine
      if (next !== d.base) Sound.rustle();
    } else {
      next = G.commitPath(level, d.base, d.color, d.path);
    }
    commit(next);
  },
});

/**
 * Extend the drag toward `cell`. A fast flick can cross a cell corner exactly, so when the finger
 * lands diagonally next to the vine tip we try both routes around the corner.
 */
function stepToward(d, cell) {
  const { level } = app;
  const next = G.extendPath(level, d.color, d.path, cell);
  if (next !== d.path) return next;
  const n = level.size;
  const head = d.path[d.path.length - 1];
  const hr = Math.floor(head / n), hc = head % n, tr = Math.floor(cell / n), tc = cell % n;
  if (Math.abs(hr - tr) !== 1 || Math.abs(hc - tc) !== 1) return d.path;
  for (const mid of [hr * n + tc, tr * n + hc]) {
    const p1 = G.extendPath(level, d.color, d.path, mid);
    if (p1.length !== d.path.length + 1) continue;
    const p2 = G.extendPath(level, d.color, p1, cell);
    if (p2.length === p1.length + 1) return p2;
  }
  return d.path;
}

function preview() {
  const d = app.drag;
  const { level } = app;
  const view = G.applyPath(level, d.base, d.color, d.path);
  if (G.cutColors(d.view, view, d.color).length) Sound.rustle();
  const complete = G.isComplete(level, d.color, d.path);
  if (complete && !d.complete) connected(d.color);
  d.complete = complete;
  d.view = view;
  const st = G.getStats(level, view);
  board.setState(view, { fill: st.percent });
  board.setActive({ color: d.color, head: d.path[d.path.length - 1] });
  updateHud(view);
}

function connected(color) {
  Sound.chime(color);
  if (save.settings.vibration) Sound.vibrate(18);
}

function commit(next) {
  app.state = next;
  const st = updateHud(next);
  board.setState(next, { fill: st.percent });
  save.inProgress = { key: app.key, state: G.serializeState(next) };
  persist();
  if (st.solved) win();
}

// ---------------------------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------------------------

function doUndo() {
  if (!app.level || app.won || app.drag) return;
  const prev = app.state;
  const next = G.undo(prev);
  if (next === prev) return;
  Sound.tap();
  commit(next);
}

function doRestart() {
  if (!app.level || app.won || app.drag) return;
  Sound.tap();
  if (app.state.vines.some((v) => v.length > 1)) Sound.rustle();
  commit(G.restart(app.level, app.state));
}

function doHint() {
  if (!app.level || app.won || app.drag) return;
  if (app.state.hintsUsed >= G.MAX_HINTS) {
    toast('The watering can is empty for this garden');
    return;
  }
  const solution = app.level.solution;
  if (!solution) return;
  const { state: next, color } = G.applyHint(app.level, app.state, solution);
  if (color < 0) {
    toast('Every vine is already in the right place');
    return;
  }
  Sound.unlock();
  const wasComplete = G.isConnected(app.level, app.state, color);
  if (G.cutColors(app.state, next, color).length) Sound.rustle();
  commit(next);
  board.pulse(color);
  if (!wasComplete) connected(color);
}

// ---------------------------------------------------------------------------------------------
// Winning
// ---------------------------------------------------------------------------------------------

function win() {
  if (app.won) return;
  app.won = true;
  const { level, state } = app;
  const perfect = G.isPerfect(level, state);
  save.inProgress = null;
  if (app.mode === 'campaign') {
    const prev = save.progress.completed[app.levelNo];
    save.progress.completed[app.levelNo] = {
      moves: prev ? Math.min(prev.moves, state.moves) : state.moves,
      perfect: !!(prev?.perfect || perfect),
    };
    save.progress.current = Math.min(Levels.TOTAL_LEVELS, Math.max(save.progress.current, app.levelNo + 1));
  } else {
    save.daily[app.dailyKey] = { moves: state.moves, perfect };
  }
  persist();

  board.celebrate(true);
  petals.start(level.pairs.map((_, c) => c));
  Sound.winMelody();
  if (save.settings.vibration) Sound.vibrate([20, 50, 30]);

  const last = app.mode === 'campaign' && app.levelNo >= Levels.TOTAL_LEVELS;
  setTimeout(() => {
    if (!app.won) return;
    $('win-title').textContent = app.mode === 'daily' ? 'Today’s Garden in Bloom!' : 'Garden in Bloom!';
    $('win-detail').textContent = `Solved in ${state.moves} move${state.moves === 1 ? '' : 's'}` +
      (state.hintsUsed ? ` · ${state.hintsUsed} watering can${state.hintsUsed === 1 ? '' : 's'}` : '');
    $('win-perfect').hidden = !perfect;
    $('next-label').textContent = app.mode === 'daily' || last ? 'Back home' : 'Next garden';
    if (last) $('win-detail').textContent += ' · every garden grown!';
    $('overlay-win').hidden = false;
    if (app.mode === 'campaign' && !last) startAutoAdvance();
    else $('auto-ring').style.setProperty('--p', '0%');
  }, 900);
}

function startAutoAdvance() {
  stopAutoAdvance();
  app.autoStart = performance.now();
  const tick = () => {
    const t = (performance.now() - app.autoStart) / AUTO_ADVANCE_MS;
    $('auto-ring').style.setProperty('--p', `${Math.min(100, t * 100)}%`);
    if (t >= 1) next();
    else app.autoTimer = requestAnimationFrame(tick);
  };
  app.autoTimer = requestAnimationFrame(tick);
}

function stopAutoAdvance() {
  cancelAnimationFrame(app.autoTimer);
  app.autoTimer = 0;
  $('auto-ring').style.setProperty('--p', '0%');
}

function hideWin() {
  stopAutoAdvance();
  $('overlay-win').hidden = true;
  petals.stop();
  board.celebrate(false);
}

function next() {
  hideWin();
  if (app.mode === 'campaign' && app.levelNo < Levels.TOTAL_LEVELS) startLevel(app.levelNo + 1);
  else show('home');
}

// ---------------------------------------------------------------------------------------------
// Tutorials
// ---------------------------------------------------------------------------------------------

const tutorialQueue = [];

function queueTutorials(level, n) {
  const want = [];
  if (!save.tutorials.basics) want.push('basics');
  if (n >= 2 && !save.tutorials.hints) want.push('hints');
  if (level.rocks.length && !save.tutorials.rocks) want.push('rocks');
  if (level.bridges.length && !save.tutorials.bridges) want.push('bridges');
  if (app.mode === 'daily' && !save.tutorials.daily) want.push('daily');
  tutorialQueue.push(...want.filter((k) => !tutorialQueue.includes(k)));
  if ($('overlay-tutorial').hidden) showNextTutorial();
}

function showNextTutorial() {
  const key = tutorialQueue.shift();
  if (!key) return;
  const t = TUTORIALS[key];
  $('tut-title').textContent = t.title;
  $('tut-text').textContent = t.text;
  $('tut-art').innerHTML = tutorialArt(t.art);
  $('overlay-tutorial').hidden = false;
  save.tutorials[key] = true;
  persist();
}

function tutorialArt(kind) {
  const cell = (x, y, fill = '#5b4431') => `<rect x="${x * 40 + 2}" y="${y * 40 + 2}" width="36" height="36" rx="8" fill="${fill}"/>`;
  const grid = (w, h, skip = []) => {
    let s = '';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!skip.includes(`${x},${y}`)) s += cell(x, y);
    return s;
  };
  const seed = (x, y, c) => `<circle cx="${x * 40 + 20}" cy="${y * 40 + 20}" r="11" fill="${c}" stroke="rgba(0,0,0,.35)" stroke-width="2"/>`;
  const vine = (pts, c) => `<polyline points="${pts.map(([x, y]) => `${x * 40 + 20},${y * 40 + 20}`).join(' ')}" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`;
  const wrap = (w, h, body) => `<svg viewBox="0 0 ${w * 40} ${h * 40}" aria-hidden="true">${body}</svg>`;
  if (kind === 'rocks') {
    return wrap(5, 3, grid(5, 3) +
      `<ellipse cx="100" cy="60" rx="16" ry="14" fill="#8d897d"/><ellipse cx="94" cy="54" rx="5" ry="3" fill="rgba(255,255,255,.3)"/>` +
      vine([[0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1]], '#2B4BFF') + seed(0, 1, '#2B4BFF') + seed(4, 1, '#2B4BFF') +
      vine([[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]], '#FF1F1F') + seed(0, 2, '#FF1F1F') + seed(4, 2, '#FF1F1F'));
  }
  if (kind === 'bridges') {
    return wrap(5, 3, grid(5, 3) +
      `<rect x="82" y="44" width="36" height="32" rx="4" fill="#a0744a"/><rect x="84" y="42" width="32" height="36" rx="4" fill="#7a5634" opacity=".7"/>` +
      vine([[2, 0], [2, 1], [2, 2]], '#F5E400') + vine([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]], '#00E5F0') +
      seed(2, 0, '#F5E400') + seed(2, 2, '#F5E400') + seed(0, 1, '#00E5F0') + seed(4, 1, '#00E5F0'));
  }
  if (kind === 'hints') {
    return wrap(5, 3, `<g transform="translate(70 18) scale(3.4)" color="#7bcb57"><use href="#i-can"/></g>` +
      `<g fill="#00E5F0" opacity=".8"><circle cx="160" cy="42" r="4"/><circle cx="170" cy="58" r="3.5"/><circle cx="158" cy="72" r="3"/></g>`);
  }
  if (kind === 'daily') {
    return wrap(5, 3, `<g transform="translate(70 10) scale(4)" color="#ffd66b"><use href="#i-sun"/></g>`);
  }
  return wrap(5, 3, grid(5, 3) +
    vine([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], '#FF1F1F') + seed(0, 0, '#FF1F1F') + seed(4, 0, '#FF1F1F') +
    vine([[0, 1], [0, 2], [1, 2], [2, 2]], '#2B4BFF') + seed(0, 1, '#2B4BFF') + seed(4, 2, '#2B4BFF') +
    `<circle cx="100" cy="100" r="15" fill="none" stroke="#fff" stroke-width="3" opacity=".7"/>`);
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

function openSettings() {
  $('set-sound').checked = save.settings.sound;
  $('set-vibration').checked = save.settings.vibration;
  $('set-colorblind').checked = save.settings.colorblind;
  $('btn-reset').textContent = 'Reset progress';
  $('btn-reset').dataset.armed = '';
  $('overlay-settings').hidden = false;
}

$('set-sound').addEventListener('change', (e) => {
  save.settings.sound = e.target.checked;
  Sound.setEnabled(save.settings.sound);
  Sound.unlock();
  Sound.tap();
  persist();
});
$('set-vibration').addEventListener('change', (e) => {
  save.settings.vibration = e.target.checked;
  if (save.settings.vibration) Sound.vibrate(15);
  persist();
});
$('set-colorblind').addEventListener('change', (e) => {
  save.settings.colorblind = e.target.checked;
  board.setColorblind(save.settings.colorblind);
  persist();
});
$('btn-reset').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (!b.dataset.armed) {
    b.dataset.armed = '1';
    b.textContent = 'Tap again to erase all progress';
    return;
  }
  const settings = save.settings;
  save = Store.reset();
  save.settings = settings;
  persist();
  $('overlay-settings').hidden = true;
  toast('Progress reset. A fresh garden awaits.');
  show('home');
});

// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------

document.addEventListener('pointerdown', () => Sound.unlock(), { capture: true });

$('btn-play').addEventListener('click', () => { Sound.unlock(); Sound.tap(); startLevel(save.progress.current || 1); });
$('btn-levels').addEventListener('click', () => {
  Sound.tap();
  app.pack = Levels.packOf(Math.min(save.progress.current || 1, Levels.TOTAL_LEVELS));
  show('levels');
});
$('btn-daily').addEventListener('click', () => { Sound.unlock(); Sound.tap(); startDaily(); });
$('btn-settings').addEventListener('click', () => { Sound.tap(); openSettings(); });
$('btn-back').addEventListener('click', () => {
  Sound.tap();
  input.cancel();
  if (app.mode === 'campaign') {
    app.pack = Levels.packOf(app.levelNo);
    show('levels');
  } else show('home');
});
for (const b of document.querySelectorAll('[data-nav]')) b.addEventListener('click', () => { Sound.tap(); show(b.dataset.nav); });
$('btn-undo').addEventListener('click', doUndo);
$('btn-restart').addEventListener('click', doRestart);
$('btn-hint').addEventListener('click', doHint);
$('btn-next').addEventListener('click', () => { Sound.tap(); next(); });
$('btn-win-menu').addEventListener('click', () => {
  Sound.tap();
  hideWin();
  if (app.mode === 'campaign') {
    app.pack = Levels.packOf(Math.min(app.levelNo + 1, Levels.TOTAL_LEVELS));
    show('levels');
  } else show('home');
});
for (const ov of ['overlay-settings', 'overlay-tutorial']) {
  const el = $(ov);
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-close]')) {
      el.hidden = true;
      if (ov === 'overlay-tutorial') showNextTutorial();
    }
  });
}

// Keyboard shortcuts for desktop players
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    for (const ov of ['overlay-settings', 'overlay-tutorial']) {
      if (!$(ov).hidden) {
        $(ov).hidden = true;
        if (ov === 'overlay-tutorial') showNextTutorial();
        return;
      }
    }
  }
  if (app.screen !== 'game') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
  else if (e.key === 'u' || e.key === 'Backspace') doUndo();
  else if (e.key === 'r') doRestart();
  else if (e.key === 'h') doHint();
  else if (e.key === 'Enter' && app.won && !$('overlay-win').hidden) next();
});

// Keep the page itself from scrolling or bouncing while a finger is on the board.
document.addEventListener('touchmove', (e) => {
  if (app.drag || !e.target.closest('.scroll')) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

const relayout = () => { if (app.screen === 'game') layout(); };
window.addEventListener('resize', relayout);
window.addEventListener('orientationchange', () => setTimeout(relayout, 200));
if (window.visualViewport) window.visualViewport.addEventListener('resize', relayout);
if (typeof ResizeObserver === 'function') new ResizeObserver(relayout).observe($('board-wrap'));

// Leaving mid-drag (app switch, call): commit what was drawn.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) input.cancel();
});

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------

async function boot() {
  renderHome();
  await Levels.loadCampaign();
  // Resume straight into an unfinished campaign level after a refresh.
  const ip = save.inProgress;
  if (ip && typeof ip.key === 'string') {
    const m = /^L(\d+)$/.exec(ip.key);
    if (m) startLevel(Number(m[1]));
    else if (ip.key === `D${Levels.dateKey()}`) startDaily();
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('[Vine Link] service worker', err));
  }
}

// QA hook: open with ?debug to poke at the game from the console.
if (new URLSearchParams(location.search).has('debug')) {
  window.__vine = { app, G, Levels, board, startLevel, startDaily, get save() { return save; } };
}

boot();
