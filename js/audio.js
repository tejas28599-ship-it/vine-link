// Vine Link — every sound is synthesized with the Web Audio API (no audio files).
// The AudioContext is created lazily on the first user gesture (required on iOS/Chrome).

let ctx = null;
let master = null;
let enabled = true;
let noiseBuffer = null;
let lastDrawTone = 0;

// Major pentatonic steps: anything played together stays soft and consonant.
const PENTA = [0, 2, 4, 7, 9];
const BASE_HZ = 261.63; // C4

function pentaHz(step, base = BASE_HZ) {
  const octave = Math.floor(step / PENTA.length);
  const semis = PENTA[((step % PENTA.length) + PENTA.length) % PENTA.length] + 12 * octave;
  return base * Math.pow(2, semis / 12);
}

export function setEnabled(on) {
  enabled = !!on;
  if (master && ctx) master.gain.setTargetAtTime(enabled ? 0.55 : 0, ctx.currentTime, 0.02);
}

/** Call from a user gesture (pointerdown / click). Safe to call repeatedly. */
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? 0.55 : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

function ready() {
  return enabled && ctx && ctx.state === 'running';
}

function voice(freq, { when = 0, type = 'sine', attack = 0.008, decay = 0.35, gain = 0.2, cutoff = 4000 } = {}) {
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  osc.connect(lp).connect(env).connect(master);
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}

/** Soft rising tone while drawing; pitch climbs with vine length. */
export function drawTone(length) {
  if (!ready()) return;
  const now = performance.now();
  if (now - lastDrawTone < 35) return; // fast swipes: don't machine-gun
  lastDrawTone = now;
  const step = Math.min(length, 22);
  voice(pentaHz(step, 220), { type: 'sine', attack: 0.006, decay: 0.12, gain: 0.07, cutoff: 1800 });
  voice(pentaHz(step, 440), { type: 'triangle', attack: 0.006, decay: 0.08, gain: 0.02, cutoff: 2400 });
}

/** Bell-like chime when a pair connects — every flower color has its own note. */
export function chime(color) {
  if (!ready()) return;
  const f = pentaHz(5 + color, BASE_HZ);
  voice(f, { decay: 1.1, gain: 0.16 });
  voice(f * 2.0, { decay: 0.6, gain: 0.05 });
  voice(f * 3.01, { decay: 0.35, gain: 0.025 });
  voice(f * 1.5, { when: 0.07, decay: 0.8, gain: 0.05 });
}

function noise() {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 0.5);
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/** Leafy rustle when a vine gets cut. */
export function rustle() {
  if (!ready()) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const src = ctx.createBufferSource();
    src.buffer = noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400 + i * 900 + Math.random() * 400;
    bp.Q.value = 1.4;
    const env = ctx.createGain();
    const s = t + i * 0.045;
    env.gain.setValueAtTime(0.0001, s);
    env.gain.exponentialRampToValueAtTime(0.18, s + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, s + 0.12);
    src.connect(bp).connect(env).connect(master);
    src.start(s, Math.random() * 0.3);
    src.stop(s + 0.15);
  }
}

/** Little "tick" for UI buttons. */
export function tap() {
  if (!ready()) return;
  voice(pentaHz(7, 330), { decay: 0.06, gain: 0.05, type: 'triangle', cutoff: 2000 });
}

/** Gentle melody on a win: rising arpeggio, then a warm chord. */
export function winMelody() {
  if (!ready()) return;
  const steps = [0, 2, 4, 5, 7, 9, 10];
  steps.forEach((s, i) => {
    voice(pentaHz(s + 5), { when: i * 0.13, decay: 0.7, gain: 0.12 });
    voice(pentaHz(s + 5) * 2, { when: i * 0.13, decay: 0.3, gain: 0.03 });
  });
  const end = steps.length * 0.13 + 0.1;
  for (const s of [5, 7, 9, 12]) voice(pentaHz(s), { when: end, attack: 0.05, decay: 1.8, gain: 0.07, type: 'triangle', cutoff: 1600 });
}

export function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* unsupported */
  }
}
