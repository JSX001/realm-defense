// Procedural sound effects via Web Audio API.
// All sounds are synthesized at runtime — no asset files required.
//
// Design rules:
// - Single shared AudioContext, lazily created on first interaction.
// - Each sound is a small function that schedules oscillators / noise on the
//   current time. They return immediately; the audio plays asynchronously.
// - Per-sound throttling so 8 archers firing at once = 1 audible twang.
// - Master gain node for global volume control.

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterVolume = 0.4;

/** Last time (ms) each sound id played; used to throttle rapid repeats. */
const lastPlayed: Map<string, number> = new Map();

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  // Browser autoplay policy requires the first AudioContext to be created
  // inside (or after) a user gesture. We try; if it fails we'll try again next call.
  try {
    const AnyWindow = window as unknown as { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext || AnyWindow.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(ctx.destination);
    return ctx;
  } catch {
    return null;
  }
}

/** Wake the AudioContext after a user gesture. Safe to call repeatedly. */
export function unlockAudio(): void {
  const c = ensureContext();
  if (c && c.state === 'suspended') c.resume();
}

export function setMasterVolume(v: number): void {
  masterVolume = Math.max(0, Math.min(1, v));
  if (masterGain) masterGain.gain.value = masterVolume;
}

export function getMasterVolume(): number { return masterVolume; }

/** Throttle helper: returns true if this sound id is allowed to play now. */
function throttle(id: string, minIntervalMs: number): boolean {
  const now = performance.now();
  const prev = lastPlayed.get(id) ?? 0;
  if (now - prev < minIntervalMs) return false;
  lastPlayed.set(id, now);
  return true;
}

/**
 * Schedule an envelope on a gain node:
 *   gain ramps from 0 → peak over `attack` seconds,
 *   then exponentially decays to ~0 over `decay` seconds.
 * Used by every sound.
 */
function envelope(g: GainNode, t0: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

/** Build a noise buffer of `seconds` length, white noise, normalized [-1, 1]. */
function noiseBuffer(seconds: number): AudioBuffer | null {
  if (!ctx) return null;
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// ──────────────────────────────────────────────────────────────────────────
// Individual sound functions. Each returns void; failures are silent.
// ──────────────────────────────────────────────────────────────────────────

/** Archer / Watchtower bow shot: short pitched zing. */
export function sfxBowShot(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('bow', 50)) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(880, t0);
  osc.frequency.exponentialRampToValueAtTime(440, t0 + 0.08);
  envelope(g, t0, 0.3, 0.005, 0.10);
  osc.connect(g).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + 0.15);
}

/** Bombard / Trebuchet: heavy thud. Low-pitched noise burst. */
export function sfxHeavyShot(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('heavy', 120)) return;
  const t0 = c.currentTime;
  // Low boom: filtered noise + sub oscillator
  const buf = noiseBuffer(0.25);
  if (!buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(400, t0);
  filter.frequency.exponentialRampToValueAtTime(120, t0 + 0.25);
  const g = c.createGain();
  envelope(g, t0, 0.5, 0.005, 0.25);
  src.connect(filter).connect(g).connect(masterGain);
  src.start(t0);

  // Sub-bass thump
  const sub = c.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(80, t0);
  sub.frequency.exponentialRampToValueAtTime(40, t0 + 0.15);
  const subG = c.createGain();
  envelope(subG, t0, 0.6, 0.005, 0.18);
  sub.connect(subG).connect(masterGain);
  sub.start(t0);
  sub.stop(t0 + 0.25);
}

/** Caltrops: light metallic scatter. */
export function sfxCaltropsShot(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('caltrops', 80)) return;
  const t0 = c.currentTime;
  const buf = noiseBuffer(0.12);
  if (!buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 3000;
  const g = c.createGain();
  envelope(g, t0, 0.25, 0.003, 0.10);
  src.connect(filter).connect(g).connect(masterGain);
  src.start(t0);
}

/** Greek fire: whoosh of flame. */
export function sfxGreekFire(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('fire', 100)) return;
  const t0 = c.currentTime;
  const buf = noiseBuffer(0.30);
  if (!buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(800, t0);
  filter.frequency.exponentialRampToValueAtTime(2400, t0 + 0.12);
  filter.Q.value = 2;
  const g = c.createGain();
  envelope(g, t0, 0.4, 0.01, 0.25);
  src.connect(filter).connect(g).connect(masterGain);
  src.start(t0);
}

/** Sapper pickaxe hit on wall: short wood/stone tick. */
export function sfxPickaxeHit(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('pickaxe', 250)) return; // ~4 hits/sec max
  const t0 = c.currentTime;
  const buf = noiseBuffer(0.05);
  if (!buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1200;
  filter.Q.value = 4;
  const g = c.createGain();
  envelope(g, t0, 0.4, 0.001, 0.04);
  src.connect(filter).connect(g).connect(masterGain);
  src.start(t0);
}

/** Wall destroyed: heavier crash. */
export function sfxWallCrumble(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('crumble', 200)) return;
  const t0 = c.currentTime;
  const buf = noiseBuffer(0.40);
  if (!buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000, t0);
  filter.frequency.exponentialRampToValueAtTime(300, t0 + 0.4);
  const g = c.createGain();
  envelope(g, t0, 0.5, 0.005, 0.40);
  src.connect(filter).connect(g).connect(masterGain);
  src.start(t0);
}

/** Enemy death: small puff. */
export function sfxEnemyDeath(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('death', 60)) return;
  const t0 = c.currentTime;
  const buf = noiseBuffer(0.10);
  if (!buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1200, t0);
  filter.frequency.exponentialRampToValueAtTime(400, t0 + 0.10);
  const g = c.createGain();
  envelope(g, t0, 0.20, 0.003, 0.10);
  src.connect(filter).connect(g).connect(masterGain);
  src.start(t0);
}

/** Tower placed: construction thunk (wood + stone). */
export function sfxTowerPlace(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('place', 100)) return;
  const t0 = c.currentTime;
  // Two short low thumps in quick succession
  for (let i = 0; i < 2; i++) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180 - i * 40, t0 + i * 0.04);
    const g = c.createGain();
    envelope(g, t0 + i * 0.04, 0.45, 0.003, 0.06);
    o.connect(g).connect(masterGain);
    o.start(t0 + i * 0.04);
    o.stop(t0 + i * 0.04 + 0.10);
  }
}

/** Tower upgrade complete: bright two-note chime. */
export function sfxUpgradeComplete(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('upgrade', 200)) return;
  const t0 = c.currentTime;
  const notes = [880, 1320]; // A5, E6
  notes.forEach((freq, i) => {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t0 + i * 0.10);
    const g = c.createGain();
    envelope(g, t0 + i * 0.10, 0.35, 0.005, 0.30);
    o.connect(g).connect(masterGain);
    o.start(t0 + i * 0.10);
    o.stop(t0 + i * 0.10 + 0.40);
  });
}

/** Tower sold: descending coin tinkle. */
export function sfxTowerSell(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('sell', 100)) return;
  const t0 = c.currentTime;
  const notes = [1200, 900, 600];
  notes.forEach((freq, i) => {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(freq, t0 + i * 0.05);
    const g = c.createGain();
    envelope(g, t0 + i * 0.05, 0.18, 0.003, 0.08);
    o.connect(g).connect(masterGain);
    o.start(t0 + i * 0.05);
    o.stop(t0 + i * 0.05 + 0.12);
  });
}

/** Wave start: low horn blast. */
export function sfxWaveStart(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('waveStart', 500)) return;
  const t0 = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(110, t0);
  o.frequency.linearRampToValueAtTime(165, t0 + 0.15);
  o.frequency.linearRampToValueAtTime(165, t0 + 0.55);
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 800;
  const g = c.createGain();
  envelope(g, t0, 0.45, 0.05, 0.55);
  o.connect(filter).connect(g).connect(masterGain);
  o.start(t0);
  o.stop(t0 + 0.7);
}

/** Wave complete: short success ding. */
export function sfxWaveComplete(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('waveDone', 500)) return;
  const t0 = c.currentTime;
  const notes = [660, 880, 1320];
  notes.forEach((freq, i) => {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t0 + i * 0.08);
    const g = c.createGain();
    envelope(g, t0 + i * 0.08, 0.30, 0.005, 0.20);
    o.connect(g).connect(masterGain);
    o.start(t0 + i * 0.08);
    o.stop(t0 + i * 0.08 + 0.30);
  });
}

/** Victory: triumphant fanfare. */
export function sfxVictory(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  const t0 = c.currentTime;
  const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t0 + i * 0.15);
    const g = c.createGain();
    envelope(g, t0 + i * 0.15, 0.45, 0.01, 0.50);
    o.connect(g).connect(masterGain);
    o.start(t0 + i * 0.15);
    o.stop(t0 + i * 0.15 + 0.65);
  });
}

/** Defeat: low descending drone. */
export function sfxDefeat(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  const t0 = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(220, t0);
  o.frequency.exponentialRampToValueAtTime(55, t0 + 1.4);
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;
  const g = c.createGain();
  envelope(g, t0, 0.45, 0.05, 1.4);
  o.connect(filter).connect(g).connect(masterGain);
  o.start(t0);
  o.stop(t0 + 1.6);
}

/** Villager dies: brief distressed cry — short downward tone. */
export function sfxVillagerDeath(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('villager', 200)) return;
  const t0 = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(440, t0);
  o.frequency.exponentialRampToValueAtTime(220, t0 + 0.30);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800;
  filter.Q.value = 3;
  const g = c.createGain();
  envelope(g, t0, 0.40, 0.01, 0.30);
  o.connect(filter).connect(g).connect(masterGain);
  o.start(t0);
  o.stop(t0 + 0.40);
}

/** UI button click: soft tick. */
export function sfxUiClick(): void {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (!throttle('uiClick', 30)) return;
  const t0 = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(1600, t0);
  const g = c.createGain();
  envelope(g, t0, 0.12, 0.001, 0.05);
  o.connect(g).connect(masterGain);
  o.start(t0);
  o.stop(t0 + 0.06);
}
