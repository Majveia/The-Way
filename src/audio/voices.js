// Building blocks shared by every mood: a per-mood Mix (fader + sends + source tracking), a
// look-ahead Clock, sustained voice layers (pads, choir, sub, shimmer) with staggered
// voice-leading, buffer instruments rendered once in JS (felt piano, harp, koto, kalimba, marimba,
// glass, celesta, tubes, temple bell) and runtime voices (bowed strings, breathy flute, brass swell).
import { mtof, clamp, makeRng, harmonicWave, choirWave, renderPartials, renderPluck, noiseBuffer } from './dsp.js';

// ---------------------------------------------------------------------------------------------
// Mix: one per mood. Every node of the mood ends in these four faders, so a crossfade or stop is
// a single click-free automation, and every long-running source is tracked for a scheduled stop.
// ---------------------------------------------------------------------------------------------
export class Mix {
  constructor(a, { level = 1, fadeIn = 3 } = {}) {
    this.a = a;
    const c = (this.c = a.ctx);
    this.lite = !!a.lite;
    this.level = level;
    const mk = (dest) => { const g = c.createGain(); g.gain.value = 0; g.connect(dest); return g; };
    this.out = mk(a.bus);
    this.verb = mk(a.reverbSend);
    this.space = mk(a.spaceSend || a.reverbSend);
    this.echo = mk(a.delaySend || a.reverbSend);
    this.faders = [this.out, this.verb, this.space, this.echo];
    this.sources = new Set();
    this.alive = true;
    this.setLevel(level, fadeIn);
  }
  setLevel(v, seconds = 2) {
    if (!this.alive) return;
    this.level = v;
    const t = this.c.currentTime;
    for (const g of this.faders) g.gain.setTargetAtTime(v, t, Math.max(0.02, seconds / 4.5));
  }
  /** Channel strip: input → (pan) → dry/verb/space/echo sends. */
  strip({ gain = 1, dry = 1, verb = 0, space = 0, echo = 0, pan = 0 } = {}) {
    const c = this.c;
    const input = c.createGain(); input.gain.value = gain;
    let node = input;
    if (pan) { const p = c.createStereoPanner(); p.pan.value = pan; input.connect(p); node = p; }
    const s = { input, node, sends: {} };
    const add = (name, amt, dest) => { const g = c.createGain(); g.gain.value = amt; node.connect(g).connect(dest); s.sends[name] = g; };
    if (dry > 0) add('dry', dry, this.out);
    if (verb > 0) add('verb', verb, this.verb);
    if (space > 0) add('space', space, this.space);
    if (echo > 0) add('echo', echo, this.echo);
    return s;
  }
  track(src) {
    this.sources.add(src);
    src.onended = () => { this.sources.delete(src); try { src.disconnect(); } catch (_) {} };
    if (!this.alive) { try { src.stop(this.endTime || this.c.currentTime); } catch (_) {} }
    return src;
  }
  /** Looping buffer source (noise beds etc.), tracked. */
  loop(buffer, dest, { rate = 1, offset = null, when = this.c.currentTime } = {}) {
    const s = this.c.createBufferSource();
    s.buffer = buffer; s.loop = true; s.playbackRate.value = rate;
    s.connect(dest);
    s.start(when, offset ?? Math.random() * buffer.duration * 0.9);
    return this.track(s);
  }
  stop(fade = 3) {
    if (!this.alive) return;
    this.alive = false;
    const c = this.c, t = c.currentTime, f = Math.max(0.05, fade);
    for (const g of this.faders) g.gain.setTargetAtTime(0, t, f / 5);
    const end = (this.endTime = t + f * 1.3 + 0.1);
    for (const s of this.sources) { try { s.stop(end); } catch (_) {} }
    if (!this.a._offline && typeof setTimeout !== 'undefined') setTimeout(() => { for (const g of this.faders) { try { g.disconnect(); } catch (_) {} } }, (f * 1.3 + 1) * 1000);
  }
}

// ---------------------------------------------------------------------------------------------
// Clock: tasks are functions (t) => nextTime, run with a look-ahead against the audio clock.
// ---------------------------------------------------------------------------------------------
export class Clock {
  constructor(c) { this.c = c; this.tasks = []; }
  add(fn, t = this.c.currentTime + 0.05) { const task = { fn, t, alive: true }; this.tasks.push(task); return task; }
  run(lookahead = 0.6) {
    const now = this.c.currentTime, horizon = now + lookahead;
    for (const task of this.tasks) {
      let guard = 0;
      if (task.t < now - 0.25) task.t = now + 0.02; // never replay a backlog after a stall
      while (task.alive && task.t < horizon && guard++ < 32) {
        let nt;
        try { nt = task.fn(Math.max(task.t, now + 0.005)); } catch (e) { console.warn('[audio] task', e); nt = null; }
        if (nt == null || !Number.isFinite(nt)) { task.alive = false; break; }
        task.t = Math.max(nt, task.t + 0.01);
      }
    }
    if (this.tasks.some((t) => !t.alive)) this.tasks = this.tasks.filter((t) => t.alive);
  }
}

// ---------------------------------------------------------------------------------------------
// Sustained notes
// ---------------------------------------------------------------------------------------------
/** Oscillator note (pads/strings/organ/brass): n detuned oscillators with one gain envelope. */
export function oscNote(m, dest, { midi, when, wave = 'warm', osc = 2, detune = 5, attack = 4, level = 0.2, pan = 0, bend = null, freq = null }) {
  const c = m.c;
  const g = c.createGain(); g.gain.value = 0;
  let out = g;
  if (pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
  out.connect(dest);
  const pw = typeof wave === 'string' ? harmonicWave(c, wave) : wave;
  const oscs = [];
  const f = freq || mtof(midi);
  for (let i = 0; i < osc; i++) {
    const o = c.createOscillator();
    o.setPeriodicWave(pw);
    o.frequency.value = f;
    o.detune.value = osc > 1 ? (i / (osc - 1) - 0.5) * 2 * detune : 0;
    if (bend) bend.connect(o.detune);
    o.connect(g);
    o.start(when);
    m.track(o);
    oscs.push(o);
  }
  const peak = level / Math.sqrt(osc);
  g.gain.setValueAtTime(0, when);
  g.gain.setTargetAtTime(peak, when, Math.max(0.01, attack / 3));
  return {
    midi, g, oscs, peak, ended: false,
    release(t, rel = 4) {
      if (this.ended) return; this.ended = true;
      g.gain.setTargetAtTime(0, t, Math.max(0.01, rel / 4.5));
      for (const o of oscs) { try { o.stop(t + rel * 1.3 + 0.05); } catch (_) {} }
    },
    drift(t, rng, cents = 5) { for (let i = 0; i < oscs.length; i++) oscs[i].detune.setTargetAtTime((osc > 1 ? (i / (osc - 1) - 0.5) * 2 * detune : 0) + rng.gauss() * cents * 0.5, t, 2.5); },
    setLevel(v, t, tc = 1) { if (!this.ended) g.gain.setTargetAtTime(v / Math.sqrt(osc), t, tc); },
  };
}

/** Choir note: two formant oscillators (vowel A/B crossfade) + gentle vibrato that fades in. */
export function choirNote(m, dest, { midi, when, vowels = ['a', 'o'], mix = 0.5, attack = 4, level = 0.15, pan = 0, vib = 1, bend = null, detune = 6 }) {
  const c = m.c;
  const g = c.createGain(); g.gain.value = 0;
  let out = g;
  if (pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
  out.connect(dest);
  const ga = c.createGain(), gb = c.createGain();
  ga.gain.value = Math.cos(mix * Math.PI / 2); gb.gain.value = Math.sin(mix * Math.PI / 2);
  ga.connect(g); gb.connect(g);
  const f = mtof(midi);
  const mkOsc = (vw, det, gg) => {
    const o = c.createOscillator();
    o.setPeriodicWave(choirWave(c, vw, midi));
    o.frequency.value = f; o.detune.value = det;
    if (bend) bend.connect(o.detune);
    o.connect(gg); o.start(when); m.track(o);
    return o;
  };
  const oa = mkOsc(vowels[0], -detune, ga), ob = mkOsc(vowels[1], detune, gb);
  const oscs = [oa, ob];
  if (vib > 0 && !m.lite) {
    const lfo = c.createOscillator(); lfo.frequency.value = 4.6 + Math.random() * 0.9;
    const lg = c.createGain(); lg.gain.value = 0;
    lg.gain.setValueAtTime(0, when); lg.gain.linearRampToValueAtTime(11 * vib, when + attack + 1.5);
    lfo.connect(lg); lg.connect(oa.detune); lg.connect(ob.detune);
    lfo.start(when); m.track(lfo); oscs.push(lfo);
  }
  g.gain.setValueAtTime(0, when);
  g.gain.setTargetAtTime(level, when, Math.max(0.01, attack / 3));
  return {
    midi, g, oscs, ended: false, peak: level,
    release(t, rel = 5) { if (this.ended) return; this.ended = true; g.gain.setTargetAtTime(0, t, Math.max(0.01, rel / 4.5)); for (const o of oscs) { try { o.stop(t + rel * 1.3 + 0.05); } catch (_) {} } },
    setMix(v, t, tc = 3) { ga.gain.setTargetAtTime(Math.cos(v * Math.PI / 2), t, tc); gb.gain.setTargetAtTime(Math.sin(v * Math.PI / 2), t, tc); },
    drift() {},
    setLevel(v, t, tc = 1) { if (!this.ended) g.gain.setTargetAtTime(v, t, tc); },
  };
}

/**
 * PadLayer: n sustained voices behind one filter. setVoicing() moves only the voices whose pitch
 * changes, each at its own staggered moment (suspensions resolving one by one, never a block chord
 * jump), crossfading old → new notes.
 */
export class PadLayer {
  constructor(mood, opts = {}) {
    const o = (this.o = { n: 4, wave: 'warm', osc: 2, detune: 5, level: 0.3, attack: 5, release: 7, lp: 1800, q: 0.5, spread: 0.7, choir: null, strip: {}, ...opts });
    if (mood.m.lite) o.osc = Math.min(o.osc, o.choir ? 2 : 1);
    this.mood = mood; this.m = mood.m; this.r = mood.r;
    const c = this.m.c;
    this.strip = this.m.strip(o.strip);
    this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = o.lp; this.filter.Q.value = o.q;
    this.gain = c.createGain(); this.gain.gain.value = 1;
    this.filter.connect(this.gain).connect(this.strip.input);
    this.voices = new Array(o.n).fill(null);
    this.current = [];
    this.vowelMix = 0.3;
    this._drift = 0;
  }
  setVoicing(midis, when, stagger = 4) {
    const o = this.o, r = this.r;
    const order = r.shuffle([...Array(o.n).keys()]);
    const offs = order.map((_, k) => (o.n > 1 ? (k / (o.n - 1)) * stagger * (0.7 + 0.6 * r()) : 0));
    this.current = midis.slice();
    for (let k = 0; k < o.n; k++) {
      const i = order[k];
      const midi = midis[i];
      const old = this.voices[i];
      if (midi == null) { if (old) { old.release(when + offs[k], o.release); this.voices[i] = null; } continue; }
      if (old && old.midi === midi && !old.ended) continue;
      const t = when + offs[k];
      const pan = o.n > 1 ? ((i / (o.n - 1)) * 2 - 1) * o.spread * (0.8 + 0.2 * r()) : 0;
      const lv = o.level * (o.voiceLevels ? o.voiceLevels[i] ?? 1 : 1);
      const nv = o.choir
        ? choirNote(this.m, this.filter, { midi, when: t, vowels: o.choir.vowels || ['a', 'o'], mix: this.vowelMix, attack: o.attack, level: lv, pan, bend: this.mood.bend, vib: o.choir.vib ?? 1 })
        : oscNote(this.m, this.filter, { midi, when: t, wave: o.wave, osc: o.osc, detune: o.detune, attack: o.attack, level: lv, pan, bend: this.mood.bend });
      if (old) old.release(t + o.attack * 0.25, o.release);
      this.voices[i] = nv;
    }
  }
  releaseAll(when, rel = this.o.release) { for (let i = 0; i < this.voices.length; i++) { const v = this.voices[i]; if (v) v.release(when, rel); this.voices[i] = null; } this.current = []; }
  setCutoff(f, tc = 1.5) { this.filter.frequency.setTargetAtTime(clamp(f, 60, 18000), this.m.c.currentTime, tc); }
  setLevel(v, tc = 2) { this.gain.gain.setTargetAtTime(v, this.m.c.currentTime, tc); }
  setVowel(v) { this.vowelMix = v; const t = this.m.c.currentTime; for (const vc of this.voices) vc?.setMix?.(v, t, 3); }
  update(dt) {
    this._drift -= dt;
    if (this._drift <= 0) {
      this._drift = 2.5 + this.r() * 3;
      const t = this.m.c.currentTime;
      const v = this.voices[Math.floor(this.r() * this.voices.length)];
      v?.drift?.(t, this.r, this.o.detune);
    }
  }
}

/** Sub/bass drone with clean crossfaded pitch changes and slow "breathing". */
export class SubDrone {
  constructor(mood, { midi = 38, level = 0.2, wave = 'sub', strip = {}, lp = 400 } = {}) {
    this.mood = mood; this.m = mood.m; this.level = level; this.wave = wave;
    const c = this.m.c;
    this.strip = this.m.strip({ dry: 1, ...strip });
    this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = lp; this.filter.Q.value = 0.3;
    this.gain = c.createGain(); this.gain.gain.value = 1;
    this.filter.connect(this.gain).connect(this.strip.input);
    this.note = null;
    if (midi != null) this.set(midi, c.currentTime, 4);
  }
  set(midi, when, fade = 4) {
    if (this.note && this.note.midi === midi && !this.note.ended) return;
    const old = this.note;
    this.note = oscNote(this.m, this.filter, { midi, when, wave: this.wave, osc: 1, attack: fade, level: this.level, bend: this.mood.bend });
    if (old) old.release(when, fade * 1.2);
  }
  setLevel(v, tc = 2) { this.gain.gain.setTargetAtTime(v, this.m.c.currentTime, tc); }
  off(when, rel = 4) { if (this.note) this.note.release(when, rel); this.note = null; }
}

/** Sparse high partials that bloom and fade (sine/glass), mostly into the long reverb. */
export class Shimmer {
  constructor(mood, { level = 0.05, max = 5, wave = 'glass', strip = { dry: 0.35, space: 1 } } = {}) {
    this.mood = mood; this.m = mood.m; this.level = level; this.max = mood.m.lite ? Math.ceil(max / 2) : max; this.wave = wave;
    this.strip = this.m.strip(strip);
    this.live = [];
  }
  spawn(midi, when, { attack = 4, hold = 3, release = 6, level = 1, pan = null } = {}) {
    const now = this.m.c.currentTime;
    this.live = this.live.filter((e) => e > now);
    if (this.live.length >= this.max) return false;
    const r = this.mood.r;
    const n = oscNote(this.m, this.strip.input, { midi, when, wave: this.wave, osc: 1, attack, level: this.level * level, pan: pan ?? r.range(-0.85, 0.85), bend: this.mood.bend });
    n.oscs[0].detune.value += r.range(-4, 4);
    n.release(when + attack + hold, release);
    this.live.push(when + attack + hold + release);
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Buffer instruments (rendered once per pitch in JS, cached per context)
// ---------------------------------------------------------------------------------------------
const INSTRUMENTS = {
  piano(midi) {
    const f0 = mtof(midi), rel = 261.6 / f0;
    const B = clamp(0.00022 * Math.pow(f0 / 261.6, 1.1), 0.00004, 0.0015);
    const T1 = 0.32 * Math.pow(rel, 0.35) + 0.18, T2 = clamp(2.1 * Math.pow(rel, 0.5), 0.5, 5.5);
    const partials = [];
    for (let n = 1; n <= 10; n++) {
      const r = n * Math.sqrt(1 + B * n * n);
      const a = Math.pow(n, -1.25) * Math.exp(-(n - 1) * 0.33) * (n === 1 ? 1 : 0.9);
      partials.push({ r, a: a * 0.62, d: T1 / (1 + 0.28 * (n - 1)), att: 0.004 });
      partials.push({ r: r * 1.0007, a: a * 0.38, d: T2 / (1 + 0.22 * (n - 1)), att: 0.004 });
    }
    const dur = clamp(1.5 + T2 * 1.5, 2, 7);
    const sr = f0 > 700 ? 24000 : f0 > 330 ? 16000 : 12000;
    return { f0, partials, dur, sr, noise: { amp: 0.035, lp: 900, dur: 0.03 }, peak: 0.55 };
  },
  kalimba(midi) {
    const f0 = mtof(midi);
    return { f0, dur: 2.2, sr: 24000, partials: [{ r: 1, a: 1, d: 0.75 * Math.pow(261.6 / f0, 0.3) }, { r: 6.27, a: 0.18, d: 0.07 }, { r: 17.5, a: 0.04, d: 0.02 }, { r: 2.01, a: 0.05, d: 0.25 }], noise: { amp: 0.06, lp: 3000, dur: 0.006 }, peak: 0.5 };
  },
  marimba(midi) {
    const f0 = mtof(midi);
    return { f0, dur: 2, sr: 24000, partials: [{ r: 1, a: 1, d: 0.42 * Math.pow(261.6 / f0, 0.4) }, { r: 3.93, a: 0.3, d: 0.1 }, { r: 9.2, a: 0.06, d: 0.03 }], noise: { amp: 0.09, lp: 1200, dur: 0.008 }, peak: 0.5 };
  },
  vibes(midi) {
    const f0 = mtof(midi);
    return { f0, dur: 4, sr: 24000, partials: [{ r: 1, a: 1, d: 1.6 }, { r: 4.0, a: 0.22, d: 0.35 }, { r: 10.0, a: 0.04, d: 0.08 }], noise: { amp: 0.03, lp: 2000, dur: 0.005 }, peak: 0.5 };
  },
  glass(midi) {
    const f0 = mtof(midi);
    return { f0, dur: 3.2, sr: 32000, partials: [{ r: 1, a: 1, d: 1.4 }, { r: 2.32, a: 0.26, d: 0.6 }, { r: 4.25, a: 0.09, d: 0.3 }, { r: 6.63, a: 0.035, d: 0.16 }], attack: 0.0025, peak: 0.5 };
  },
  celesta(midi) {
    const f0 = mtof(midi);
    return { f0, dur: 2.6, sr: 32000, partials: [{ r: 1, a: 1, d: 0.95 }, { r: 2, a: 0.16, d: 0.3 }, { r: 3.01, a: 0.07, d: 0.12 }, { r: 4.16, a: 0.04, d: 0.05 }], noise: { amp: 0.04, lp: 4000, dur: 0.004 }, peak: 0.5 };
  },
  tube(midi) {
    const f0 = mtof(midi);
    return { f0, dur: 4, sr: 32000, partials: [{ r: 1, a: 1, d: 2.2 }, { r: 2.756, a: 0.45, d: 1 }, { r: 5.404, a: 0.2, d: 0.4 }, { r: 8.933, a: 0.08, d: 0.18 }], attack: 0.002, peak: 0.5 };
  },
  bell(midi) { // large temple bell (struck with a wooden beam): deep hum, slow beating
    const f0 = mtof(midi);
    const P = [[0.5, 0.7, 6.5], [0.5015, 0.35, 7], [1, 0.75, 4.5], [1.0035, 0.3, 4], [1.19, 0.45, 3.2], [1.5, 0.28, 2.4], [2, 0.5, 2.6], [2.51, 0.18, 1.5], [2.66, 0.14, 1.3], [3.01, 0.16, 1], [4.1, 0.06, 0.6], [5.4, 0.04, 0.4]];
    return { f0, dur: 11, sr: 22050, partials: P.map(([r, a, d]) => ({ r, a, d, att: 0.006 })), noise: { amp: 0.25, lp: 500, dur: 0.05 }, peak: 0.55 };
  },
  handbell(midi) {
    const f0 = mtof(midi);
    const P = [[1, 1, 2.4], [2.0, 0.35, 1.3], [2.4, 0.22, 0.9], [3.0, 0.12, 0.5], [4.2, 0.05, 0.25]];
    return { f0, dur: 4, sr: 32000, partials: P.map(([r, a, d]) => ({ r, a, d })), attack: 0.0015, peak: 0.5 };
  },
};
const PLUCKS = {
  harp: (midi) => { const f0 = mtof(midi); const decay = clamp(6 * Math.pow(130 / f0, 0.55), 1.2, 7); return { f0, decay, dur: Math.min(decay * 1.05, 6), bright: 0.42, pick: 0.21, sr: f0 < 400 ? 24000 : 32000, body: 0.25 }; },
  koto: (midi) => { const f0 = mtof(midi); const decay = clamp(3.4 * Math.pow(196 / f0, 0.5), 1, 4); return { f0, decay, dur: Math.min(decay, 4), bright: 0.72, pick: 0.11, sr: 32000, body: 0.15 }; },
  guitar: (midi) => { const f0 = mtof(midi); const decay = clamp(4 * Math.pow(110 / f0, 0.5), 1, 5); return { f0, decay, dur: Math.min(decay, 5), bright: 0.5, pick: 0.16, sr: f0 < 300 ? 24000 : 32000, body: 0.4 }; },
};
export const INSTRUMENT_NAMES = [...Object.keys(INSTRUMENTS), ...Object.keys(PLUCKS)];

export function instrumentBuffer(c, kind, midi) {
  midi = Math.round(midi);
  if (PLUCKS[kind]) return renderPluck(c, `${kind}:${midi}`, PLUCKS[kind](midi));
  const spec = (INSTRUMENTS[kind] || INSTRUMENTS.piano)(midi);
  return renderPartials(c, `${kind}:${midi}`, spec);
}

/** Plays rendered tones through its own strip (+ optional tone filter / vibes tremolo). */
export class BufferInstrument {
  constructor(mood, kind, { strip = { dry: 1, verb: 0.3 }, gain = 1, lp = null, tremolo = 0, maxVoices = 14 } = {}) {
    this.mood = mood; this.m = mood.m; this.kind = kind; this.gain = gain;
    const c = this.m.c;
    this.strip = this.m.strip(strip);
    this.input = this.strip.input;
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.3; f.connect(this.strip.input); this.input = f; this.lp = f; }
    if (tremolo && !this.m.lite) {
      const tg = c.createGain(); tg.gain.value = 1 - tremolo * 0.5;
      const lfo = c.createOscillator(); lfo.frequency.value = 4.2;
      const d = c.createGain(); d.gain.value = tremolo * 0.5;
      lfo.connect(d).connect(tg.gain); lfo.start(); this.m.track(lfo);
      tg.connect(this.input); this.input = tg;
    }
    this.maxVoices = mood.m.lite ? Math.ceil(maxVoices / 2) : maxVoices;
    this.voices = [];
    this.queue = [];
  }
  /** Pre-render a set of pitches (spread over frames by the caller to avoid hitches). */
  warm(midis) { for (const m of midis) this.queue.push(m); }
  pump(n = 1) { while (n-- > 0 && this.queue.length) instrumentBuffer(this.m.c, this.kind, this.queue.shift()); }
  play(midi, when, vel = 0.7, { pan = 0, dur = null, detune = 0, bendTo = null, bendAt = 0.12 } = {}) {
    const c = this.m.c;
    const now = c.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    if (this.voices.length >= this.maxVoices) { const v = this.voices.shift(); v.g.gain.setTargetAtTime(0, Math.max(now, when - 0.05), 0.04); }
    const buf = instrumentBuffer(c, this.kind, midi);
    const s = c.createBufferSource(); s.buffer = buf;
    s.detune.value = detune;
    if (this.mood.bend) this.mood.bend.connect(s.detune);
    if (bendTo != null) { s.playbackRate.setValueAtTime(1, when + bendAt); s.playbackRate.exponentialRampToValueAtTime(Math.pow(2, bendTo / 12), when + bendAt + 0.18); }
    const g = c.createGain(); g.gain.value = this.gain * vel * vel;
    let out = g;
    if (pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    s.connect(g); out.connect(this.input);
    s.start(when);
    let end = when + buf.duration;
    if (dur != null && dur < buf.duration) { g.gain.setValueAtTime(this.gain * vel * vel, when + dur); g.gain.setTargetAtTime(0, when + dur, 0.12); end = when + dur + 0.8; s.stop(end); }
    this.m.track(s);
    this.voices.push({ g, end });
    return s;
  }
}

// ---------------------------------------------------------------------------------------------
// Runtime expressive voices
// ---------------------------------------------------------------------------------------------
/** Bowed string line (cello/viola-like): detuned string waves, opening low-pass, late vibrato. */
export function bowed(m, dest, { midi, when, dur = 4, vel = 0.7, attack = 0.9, release = 1.6, pan = 0, bend = null, bright = 1 }) {
  const c = m.c;
  const f = mtof(midi);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
  const fc = Math.min(4200, f * 4 + 500 * vel) * bright;
  lp.frequency.setValueAtTime(fc * 0.35, when); lp.frequency.setTargetAtTime(fc, when, attack * 0.6);
  lp.frequency.setTargetAtTime(fc * 0.7, when + dur, release / 3);
  const g = c.createGain(); g.gain.value = 0;
  let out = g;
  if (pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
  lp.connect(g); out.connect(dest);
  const wave = harmonicWave(c, 'string');
  const lfo = c.createOscillator(); lfo.frequency.value = 5 + Math.random() * 0.6;
  const lg = c.createGain(); lg.gain.setValueAtTime(0, when); lg.gain.linearRampToValueAtTime(0, when + attack * 0.8); lg.gain.linearRampToValueAtTime(13, when + attack * 0.8 + 1.2);
  lfo.connect(lg);
  const oscs = [lfo];
  const n = m.lite ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const o = c.createOscillator(); o.setPeriodicWave(wave); o.frequency.value = f; o.detune.value = n > 1 ? (i ? 4 : -4) : 0;
    lg.connect(o.detune); if (bend) bend.connect(o.detune);
    o.connect(lp); oscs.push(o);
  }
  const pk = 0.16 * vel / Math.sqrt(n);
  g.gain.setValueAtTime(0, when);
  g.gain.setTargetAtTime(pk, when, attack / 3);
  g.gain.setTargetAtTime(pk * 0.8, when + attack, dur * 0.5);
  g.gain.setTargetAtTime(0, when + dur, release / 4);
  const end = when + dur + release * 1.4;
  for (const o of oscs) { o.start(when); o.stop(end); m.track(o); }
  return end;
}

/** Breathy end-blown flute (shakuhachi-ish): soft tone + band-passed breath, bends and vibrato. */
export function flute(m, dest, { midi, when, dur = 2, vel = 0.7, pan = 0, bendFrom = 0, bend = null }) {
  const c = m.c;
  const f = mtof(midi);
  const g = c.createGain(); g.gain.value = 0;
  let out = g;
  if (pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
  out.connect(dest);
  const o = c.createOscillator(); o.setPeriodicWave(harmonicWave(c, 'soft')); o.frequency.value = f;
  if (bendFrom) { o.detune.setValueAtTime(bendFrom * 100, when); o.detune.setTargetAtTime(0, when + 0.05, 0.12); }
  if (bend) bend.connect(o.detune);
  const lfo = c.createOscillator(); lfo.frequency.value = 4.8;
  const lg = c.createGain(); lg.gain.setValueAtTime(0, when); lg.gain.linearRampToValueAtTime(0, when + Math.min(0.8, dur * 0.4)); lg.gain.linearRampToValueAtTime(16, when + Math.min(dur, 1.8));
  lfo.connect(lg).connect(o.detune);
  o.connect(g);
  // breath
  const nb = c.createBufferSource(); nb.buffer = noiseBuffer(c, 'white', m.lite ? 4 : 6, 1); nb.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(5000, f * 2.1); bp.Q.value = 1.6;
  const ng = c.createGain(); ng.gain.value = 0;
  nb.connect(bp).connect(ng).connect(g);
  ng.gain.setValueAtTime(0, when); ng.gain.linearRampToValueAtTime(0.55, when + 0.06); ng.gain.setTargetAtTime(0.16, when + 0.08, 0.15);
  const pk = 0.12 * vel;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(pk * 0.6, when + 0.12);
  g.gain.setTargetAtTime(pk, when + 0.12, 0.35);
  g.gain.setTargetAtTime(0, when + dur, 0.25);
  const end = when + dur + 1.5;
  o.start(when); lfo.start(when); nb.start(when, Math.random() * 3);
  for (const s of [o, lfo, nb]) { s.stop(end); m.track(s); }
  return end;
}

/** Slow brass/analog swell: rich wave through a low-pass that opens with the envelope. */
export function brassSwell(m, dest, { midi, when, dur = 8, vel = 0.7, attack = 3, release = 4, pan = 0, bend = null, osc = 2, bright = 1, wave = 'brass', detune = 7 }) {
  const c = m.c;
  const f = mtof(midi);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
  const top = Math.min(5000, (f * 3 + 900 * vel) * bright);
  lp.frequency.setValueAtTime(f * 0.9, when);
  lp.frequency.setTargetAtTime(top, when, attack / 2.2);
  lp.frequency.setTargetAtTime(f * 1.1, when + dur, release / 2.5);
  const g = c.createGain(); g.gain.value = 0;
  let out = g;
  if (pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
  lp.connect(g); out.connect(dest);
  const n = m.lite ? 1 : osc;
  const oscs = [];
  for (let i = 0; i < n; i++) {
    const o = c.createOscillator(); o.setPeriodicWave(harmonicWave(c, wave)); o.frequency.value = f;
    o.detune.value = n > 1 ? (i / (n - 1) - 0.5) * 2 * detune : 0;
    if (bend) bend.connect(o.detune);
    o.connect(lp); oscs.push(o);
  }
  const pk = 0.14 * vel / Math.sqrt(n);
  g.gain.setValueAtTime(0, when);
  g.gain.setTargetAtTime(pk, when, attack / 3);
  g.gain.setTargetAtTime(0, when + dur, release / 4.5);
  const end = when + dur + release * 1.3;
  for (const o of oscs) { o.start(when); o.stop(end); m.track(o); }
  return end;
}

/** Struck/bowed metal resonance (inharmonic partials with slow beating) — runtime oscillators. */
export function metalSwell(m, dest, { midi, when, attack = 3, dur = 10, level = 0.05, pan = 0, ratios = [1, 1.47, 2.09, 2.56, 3.71], bend = null }) {
  const c = m.c, f = mtof(midi);
  const g = c.createGain(); g.gain.value = 0;
  let out = g;
  if (pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
  out.connect(dest);
  const n = m.lite ? Math.min(3, ratios.length) : ratios.length;
  const end = when + attack + dur + 1;
  for (let i = 0; i < n; i++) {
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.value = f * ratios[i] * (1 + (Math.random() - 0.5) * 0.002);
    if (bend) bend.connect(o.detune);
    const pg = c.createGain(); pg.gain.value = 1 / (1 + i * 0.9);
    o.connect(pg).connect(g);
    o.start(when); o.stop(end); m.track(o);
  }
  g.gain.setValueAtTime(0, when);
  g.gain.setTargetAtTime(level, when, attack / 3);
  g.gain.setTargetAtTime(0, when + attack, dur / 4);
  return end;
}

export { makeRng };
