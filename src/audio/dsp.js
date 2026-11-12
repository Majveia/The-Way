// Low-level DSP for THE WAY's score. Everything here is synthesized: seeded randomness, cached
// noise / impulse-response buffers, harmonic PeriodicWaves (including formant "choir" spectra),
// and offline tone rendering (additive + Karplus–Strong) into small AudioBuffers that play back
// for almost no CPU at runtime. No samples, no network.

export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (d) => Math.pow(10, d / 20);

/** Small fast seeded PRNG (mulberry32) with musical helpers. */
export function makeRng(seed = (Math.random() * 4294967296) >>> 0) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.gauss = () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r()); };
  r.weighted = (items, weights) => {
    let sum = 0; for (const w of weights) sum += w;
    let x = r() * sum;
    for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x <= 0) return items[i]; }
    return items[items.length - 1];
  };
  r.shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  r.exp = (mean) => -Math.log(1 - r() * 0.999) * mean; // Poisson inter-arrival
  r.fork = () => makeRng((r() * 4294967296) >>> 0);
  return r;
}

// ---------------------------------------------------------------------------------------------
// Per-context caches (buffers / waves are shared by every mood and cue on the same context).
// ---------------------------------------------------------------------------------------------
const CACHES = new WeakMap();
export function memo(ctx, key, make) {
  let m = CACHES.get(ctx);
  if (!m) CACHES.set(ctx, (m = new Map()));
  let v = m.get(key);
  if (v === undefined) { v = make(); m.set(key, v); }
  return v;
}

/**
 * Seamlessly looping noise buffer ('white' | 'pink' | 'brown'), decorrelated per channel,
 * RMS-normalised to ~0.25 so every noise colour mixes at a comparable level.
 */
export function noiseBuffer(ctx, type = 'white', seconds = 8, channels = 2) {
  return memo(ctx, `noise:${type}:${seconds}:${channels}`, () => {
    const sr = ctx.sampleRate, len = Math.floor(sr * seconds), xf = Math.floor(sr * 0.3);
    const buf = ctx.createBuffer(channels, len, sr);
    const r = makeRng(0x9e3779b9 ^ (type.length * 7919) ^ (channels * 104729) ^ seconds);
    for (let ch = 0; ch < channels; ch++) {
      const tmp = new Float32Array(len + xf);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < tmp.length; i++) {
        const w = r() * 2 - 1;
        if (type === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          tmp[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
        } else if (type === 'brown') {
          last = (last + 0.02 * w) / 1.02; tmp[i] = last;
        } else tmp[i] = w;
      }
      // loop crossfade: the tail continues smoothly into the head
      for (let i = 0; i < xf; i++) {
        const k = i / xf, a = Math.sin(k * Math.PI * 0.5), b = Math.cos(k * Math.PI * 0.5);
        tmp[i] = tmp[i] * a + tmp[len + i] * b;
      }
      let mean = 0; for (let i = 0; i < len; i++) mean += tmp[i]; mean /= len;
      let pow = 0; for (let i = 0; i < len; i++) { tmp[i] -= mean; pow += tmp[i] * tmp[i]; }
      const g = 0.25 / Math.sqrt(pow / len + 1e-12);
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = tmp[i] * g;
    }
    return buf;
  });
}

/**
 * Synthetic stereo reverb impulse: smooth onset after a pre-delay, a few early reflections,
 * exponential decay (t60) whose high frequencies die faster (closing one-pole low-pass),
 * independent noise per channel for a wide, decorrelated tail.
 */
export function impulseBuffer(ctx, { seconds = 5, t60 = 4, pre = 0.02, bright = 9000, dark = 700, damp = 1.2, early = 0.5, seed = 11 } = {}) {
  return memo(ctx, `ir:${seconds}:${t60}:${pre}:${bright}:${dark}:${damp}:${early}:${seed}`, () => {
    const sr = ctx.sampleRate, len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const r = makeRng(seed);
    const k = 6.907755 / t60;
    const preS = Math.floor(pre * sr);
    const decPerSample = Math.exp(-k / sr);
    const B = 64; // coefficients are refreshed per block (cheap even for 10 s tails on phones)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0, lp2 = 0, env = 1, a = 0.5, comp = 1;
      for (let i = preS; i < len; i++) {
        const j = i - preS;
        if (j % B === 0) {
          const t = j / sr;
          const fc = dark + (bright - dark) * Math.exp(-t * damp);
          a = 1 - Math.exp((-TAU * fc) / sr);
          comp = Math.pow((2 - a) / a, 0.3); // partly compensate the filter's level loss
        }
        lp += a * (r() * 2 - 1 - lp);
        lp2 += a * (lp - lp2);
        const t = j / sr;
        const onset = t < 0.035 ? (t / 0.035) * (t / 0.035) : 1;
        const fadeEnd = len - i < sr * 0.25 ? (len - i) / (sr * 0.25) : 1;
        d[i] = lp2 * comp * env * onset * fadeEnd;
        env *= decPerSample;
      }
      // early reflections (different per side): short soft taps
      const taps = 9;
      for (let j = 0; j < taps; j++) {
        const t = pre + 0.006 + r() * 0.075;
        const idx = Math.floor(t * sr);
        const amp = early * (0.9 - j / taps * 0.6) * r.sign() * 0.15;
        for (let q = 0; q < 24 && idx + q < len; q++) d[idx + q] += amp * Math.exp(-q / 5);
      }
    }
    return buf;
  });
}

// ---------------------------------------------------------------------------------------------
// Harmonic spectra → PeriodicWave (one oscillator node per voice, arbitrary timbre).
// ---------------------------------------------------------------------------------------------
const SPECTRA = {
  warm: (n) => Math.pow(n, -1.15) / (1 + Math.pow(n / 12, 2)),
  string: (n) => (Math.pow(n, -1) * (0.82 + 0.18 * Math.cos(n * 1.31))) / (1 + Math.pow(n / 16, 3)),
  organ: (n) => [0, 1, 0.55, 0.32, 0.24, 0.12, 0.1, 0.05, 0.06, 0.02, 0.025, 0.01, 0.012][n] || 0,
  hollow: (n) => (n % 2 ? Math.pow(n, -1.25) : 0.06 / n),
  glass: (n) => [0, 1, 0.05, 0.14, 0.02, 0.05, 0, 0.02][n] || 0,
  soft: (n) => [0, 1, 0.22, 0.07, 0.025, 0.01][n] || 0,
  sub: (n) => [0, 1, 0.3, 0.1, 0.035][n] || 0,
  brass: (n) => Math.pow(n, -0.85) / (1 + Math.pow(n / 22, 2)),
  reed: (n) => (n % 2 ? Math.pow(n, -0.9) : 0.35 * Math.pow(n, -1.1)) / (1 + Math.pow(n / 18, 2)),
  hum: (n) => [0, 1, 0.5, 0.42, 0.2, 0.16, 0.08, 0.05, 0.03][n] || 0,
};

export function harmonicWave(ctx, name, nHarm = 48) {
  return memo(ctx, `wave:${name}:${nHarm}`, () => {
    const f = SPECTRA[name] || SPECTRA.warm;
    const real = new Float32Array(nHarm + 1), imag = new Float32Array(nHarm + 1);
    for (let n = 1; n <= nHarm; n++) imag[n] = f(n);
    return ctx.createPeriodicWave(real, imag);
  });
}

// Formant tables (alto-ish, softened upper formants for a distant, non-harsh choir).
// [frequency Hz, bandwidth Hz, gain]
const VOWELS = {
  a: [[800, 90, 1], [1150, 100, 0.55], [2800, 140, 0.07], [3500, 150, 0.02]],
  o: [[470, 80, 1], [820, 90, 0.42], [2800, 120, 0.04]],
  u: [[330, 60, 1], [720, 70, 0.2], [2500, 160, 0.015]],
  e: [[420, 70, 1], [1650, 100, 0.14], [2700, 130, 0.05]],
  m: [[280, 60, 1], [1100, 160, 0.08], [2200, 200, 0.02]], // hum
};

/** Choir vowel wave for a given note: glottal-ish source shaped by formant resonances. */
export function choirWave(ctx, vowel, midi) {
  const m = Math.round(midi);
  return memo(ctx, `choir:${vowel}:${m}`, () => {
    const f0 = mtof(m);
    const fm = VOWELS[vowel] || VOWELS.a;
    const nHarm = Math.max(2, Math.min(64, Math.floor(4200 / f0)));
    const real = new Float32Array(nHarm + 1), imag = new Float32Array(nHarm + 1);
    for (let n = 1; n <= nHarm; n++) {
      const f = n * f0;
      let env = 0.012;
      for (const [F, B, G] of fm) {
        const bw = Math.max(B, f0 * 0.55);
        const x = (2 * (f - F)) / bw;
        env += G / (1 + x * x);
      }
      imag[n] = Math.pow(n, -0.75) * env * (f > 3200 ? Math.exp(-(f - 3200) / 600) : 1);
    }
    return ctx.createPeriodicWave(real, imag);
  });
}

// ---------------------------------------------------------------------------------------------
// Offline tone rendering into small AudioBuffers (cached). Runs in plain JS: a damped rotation
// oscillator per partial, so a 3-second note costs a few milliseconds once, then ~nothing.
// ---------------------------------------------------------------------------------------------
export function renderPartials(ctx, key, { f0, partials, dur = 3, sr = 24000, attack = 0.003, noise = null, peak = 0.5, seed = 5 }) {
  return memo(ctx, `tone:${key}`, () => {
    const len = Math.max(64, Math.ceil(dur * sr));
    const d = new Float32Array(len);
    const nyq = sr * 0.46;
    for (const p of partials) {
      const f = f0 * p.r;
      if (f >= nyq || f <= 0 || p.a <= 0) continue;
      const w = (TAU * f) / sr, cw = Math.cos(w), sw = Math.sin(w);
      let c = 1, s = 0;
      if (p.ph) { c = Math.cos(p.ph); s = Math.sin(p.ph); }
      const dec = Math.exp(-1 / Math.max(1e-3, p.d * sr));
      const att = Math.max(1, Math.floor((p.att ?? attack) * sr));
      let amp = p.a;
      for (let i = 0; i < len; i++) {
        d[i] += s * amp * (i < att ? i / att : 1);
        const nc = c * cw - s * sw; s = c * sw + s * cw; c = nc;
        amp *= dec;
        if (amp < 2e-5) break;
      }
    }
    if (noise) {
      const r = makeRng(seed);
      const nl = Math.min(len, Math.floor((noise.dur || 0.03) * sr));
      const a = 1 - Math.exp((-TAU * (noise.lp || 2000)) / sr);
      let y = 0, y2 = 0;
      for (let i = 0; i < nl; i++) {
        y += a * (r() * 2 - 1 - y); y2 += a * (y - y2);
        d[i] += y2 * noise.amp * Math.exp((-i / sr) / ((noise.dur || 0.03) * 0.3));
      }
    }
    return toBuffer(ctx, d, sr, peak);
  });
}

/**
 * Karplus–Strong plucked string with fractional-delay tuning (Jaffe–Smith): in tune at any pitch.
 * bright: excitation low-pass 0..1, decay: approx T60 (s) of the fundamental, pick: pluck position.
 */
export function renderPluck(ctx, key, { f0, dur = 3, sr = 32000, bright = 0.5, decay = 3, pick = 0.18, peak = 0.5, seed = 9, body = 0 }) {
  return memo(ctx, `ks:${key}`, () => {
    const len = Math.ceil(dur * sr);
    const out = new Float32Array(len);
    const P = sr / f0;
    let N = Math.floor(P - 0.5);
    let D = P - 0.5 - N;
    if (D < 0.15) { N -= 1; D += 1; }
    const eta = (1 - D) / (1 + D);
    const rho = Math.pow(0.001, 1 / (f0 * decay));
    const line = new Float32Array(N);
    const r = makeRng(seed);
    // excitation: low-passed noise with pick-position comb
    const a = 0.08 + 0.9 * bright * bright;
    let y = 0;
    const exc = new Float32Array(N);
    for (let i = 0; i < N; i++) { y += a * (r() * 2 - 1 - y); exc[i] = y; }
    const pk = Math.max(1, Math.round(pick * N));
    for (let i = 0; i < N; i++) line[i] = exc[i] - (i >= pk ? exc[i - pk] : 0) * 0.9;
    let idx = 0, prev = 0, apIn = 0, apOut = 0;
    for (let n = 0; n < len; n++) {
      const x = line[idx];
      out[n] = x;
      const avg = rho * 0.5 * (x + prev); prev = x;
      const ap = eta * avg + apIn - eta * apOut; apIn = avg; apOut = ap;
      line[idx] = ap;
      idx++; if (idx >= N) idx = 0;
    }
    if (body > 0) { // gentle wooden body: a normalised 2-pole resonance (~250 Hz) mixed under the string
      const fr = 250, q = 0.985;
      const w = (TAU * fr) / sr, b1 = 2 * q * Math.cos(w), b2 = -q * q, gIn = 1 - q;
      let y1 = 0, y2 = 0;
      for (let n = 0; n < len; n++) { const v = out[n] * gIn + b1 * y1 + b2 * y2; y2 = y1; y1 = v; out[n] += v * body * 2; }
    }
    // fade the tail
    const fl = Math.floor(sr * 0.08);
    for (let i = 0; i < fl; i++) out[len - 1 - i] *= i / fl;
    return toBuffer(ctx, out, sr, peak);
  });
}

function toBuffer(ctx, d, sr, peak) {
  let mx = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > mx) mx = v; }
  const g = mx > 0 ? peak / mx : 0;
  const fl = Math.min(d.length >> 2, Math.floor(sr * 0.02));
  for (let i = 0; i < d.length; i++) d[i] *= g;
  for (let i = 0; i < fl; i++) d[d.length - 1 - i] *= i / fl;
  const buf = ctx.createBuffer(1, d.length, sr);
  buf.copyToChannel(d, 0);
  return buf;
}

/** Generic short buffer synthesized by a callback (fill(dataArray, sr, rng)). Cached by key. */
export function synthBuffer(ctx, key, seconds, sr, fill, channels = 1, seed = 3) {
  return memo(ctx, `syn:${key}`, () => {
    const len = Math.max(64, Math.ceil(seconds * sr));
    const buf = ctx.createBuffer(channels, len, sr);
    const r = makeRng(seed);
    for (let ch = 0; ch < channels; ch++) {
      const d = new Float32Array(len);
      fill(d, sr, r, ch);
      buf.copyToChannel(d, ch);
    }
    return buf;
  });
}

// ---------------------------------------------------------------------------------------------
// AudioParam helpers
// ---------------------------------------------------------------------------------------------
/** Smoothly move a param toward v (setTargetAtTime), skipping tiny changes to avoid event spam. */
export function glide(param, v, t, tc = 0.2) {
  if (!Number.isFinite(v)) return;
  param.setTargetAtTime(v, t, Math.max(0.005, tc));
}

/** Freeze a param at its current value at time t (cancel future automation without a jump). */
export function hold(param, t) {
  if (param.cancelAndHoldAtTime) { try { param.cancelAndHoldAtTime(t); return; } catch (_) {} }
  const v = param.value;
  param.cancelScheduledValues(t);
  param.setValueAtTime(v, t);
}

/** Percussive envelope: 0 → peak in `a` s (linear), then exponential-ish decay of time-constant `d`. */
export function percEnv(param, t, peak, a, d, floor = 0) {
  param.setValueAtTime(floor, t);
  param.linearRampToValueAtTime(peak, t + Math.max(0.001, a));
  param.setTargetAtTime(floor, t + Math.max(0.001, a), Math.max(0.002, d));
}
