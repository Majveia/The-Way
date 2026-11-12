// Music theory for the generative score: modes, keys, a chord "walker" that never loops audibly
// (weighted choices + history avoidance + common-tone/voice-leading preference), a minimal-motion
// voice-leader, phrase generator, and THE WAY leitmotif expressed in scale degrees so it adapts
// to whatever mode the current world is in.

export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  majPent: [0, 2, 4, 7, 9],
  minPent: [0, 3, 5, 7, 10],
  yo: [0, 2, 5, 7, 9],
  insen: [0, 1, 5, 7, 10],
  whole: [0, 2, 4, 6, 8, 10],
};

const pcOf = (m) => ((Math.round(m) % 12) + 12) % 12;

export class Key {
  /** root: pitch class 0..11 (0 = C), mode: name in MODES */
  constructor(root, mode = 'lydian') {
    this.root = ((root % 12) + 12) % 12;
    this.mode = mode;
    this.steps = MODES[mode] || MODES.ionian;
    this.n = this.steps.length;
    this.pcs = this.steps.map((s) => (s + this.root) % 12);
  }
  /** midi of scale degree `deg` (0 = tonic, may be negative or > n) above tonic octave `tonicMidi` */
  midi(deg, tonicMidi) {
    const n = this.n, o = Math.floor(deg / n), i = ((deg % n) + n) % n;
    return tonicMidi + 12 * o + this.steps[i];
  }
  /** nearest tonic midi at or below m */
  tonicBelow(m) { return m - ((pcOf(m) - this.root + 12) % 12); }
  contains(m) { return this.pcs.includes(pcOf(m)); }
  /** scale degree index of a midi note (or -1) */
  degreeOf(m) { return this.pcs.indexOf(pcOf(m)); }
  /** all scale midis in [lo, hi] */
  range(lo, hi) { const out = []; for (let m = Math.ceil(lo); m <= hi; m++) if (this.contains(m)) out.push(m); return out; }
  snap(m) { for (let d = 0; d < 7; d++) { if (this.contains(m + d)) return m + d; if (this.contains(m - d)) return m - d; } return m; }
  /** pitch classes of a chord built on degree `deg` using scale-step offsets */
  chordPcs(deg, offsets) { return offsets.map((o) => this.pcs[(((deg + o) % this.n) + this.n) % this.n]); }
  shared(other) { return this.pcs.filter((p) => other.pcs.includes(p)).length; }
}

// Chord shapes as scale-step offsets from the chord root.
export const SHAPES = {
  triad: [0, 2, 4],
  sus2: [0, 1, 4],
  sus4: [0, 3, 4],
  add9: [0, 2, 4, 8],
  seventh: [0, 2, 4, 6],
  ninth: [0, 2, 4, 6, 8],
  six9: [0, 2, 4, 5, 8],
  quartal: [0, 3, 6],
  fifths: [0, 4, 8],
  open: [0, 4, 9],
};

// Palettes: which degrees/shapes a mode likes. w = base weight.
export const PALETTES = {
  lydian: [
    { deg: 0, shapes: ['add9', 'six9', 'fifths', 'seventh'], w: 3 },
    { deg: 1, shapes: ['triad', 'add9', 'sus2'], w: 2.2 },
    { deg: 2, shapes: ['seventh', 'triad'], w: 0.9 },
    { deg: 4, shapes: ['sus2', 'add9', 'triad'], w: 1.4 },
    { deg: 5, shapes: ['seventh', 'add9', 'triad'], w: 1.6 },
    { deg: 6, shapes: ['sus4', 'triad'], w: 0.5 },
  ],
  ionian: [
    { deg: 0, shapes: ['add9', 'six9', 'triad'], w: 3 },
    { deg: 1, shapes: ['seventh', 'add9'], w: 1.2 },
    { deg: 3, shapes: ['add9', 'triad', 'six9'], w: 2.2 },
    { deg: 4, shapes: ['sus4', 'sus2', 'add9'], w: 1.4 },
    { deg: 5, shapes: ['seventh', 'add9', 'triad'], w: 1.8 },
    { deg: 2, shapes: ['seventh', 'triad'], w: 0.8 },
  ],
  mixolydian: [
    { deg: 0, shapes: ['add9', 'sus2', 'triad'], w: 3 },
    { deg: 6, shapes: ['add9', 'triad', 'six9'], w: 2.2 },
    { deg: 3, shapes: ['add9', 'triad'], w: 1.8 },
    { deg: 4, shapes: ['seventh', 'triad'], w: 1 },
    { deg: 1, shapes: ['seventh', 'add9'], w: 1 },
    { deg: 5, shapes: ['seventh', 'triad'], w: 0.8 },
  ],
  dorian: [
    { deg: 0, shapes: ['seventh', 'add9', 'ninth', 'sus2'], w: 3 },
    { deg: 3, shapes: ['add9', 'triad', 'seventh'], w: 2.2 },
    { deg: 2, shapes: ['add9', 'six9', 'triad'], w: 1.6 },
    { deg: 6, shapes: ['add9', 'triad', 'sus2'], w: 1.6 },
    { deg: 4, shapes: ['seventh', 'sus4'], w: 0.9 },
    { deg: 1, shapes: ['seventh', 'sus4'], w: 0.6 },
  ],
  aeolian: [
    { deg: 0, shapes: ['add9', 'seventh', 'sus2'], w: 3 },
    { deg: 5, shapes: ['add9', 'six9', 'seventh'], w: 2.3 },
    { deg: 2, shapes: ['add9', 'six9', 'triad'], w: 1.8 },
    { deg: 6, shapes: ['add9', 'sus2', 'triad'], w: 1.5 },
    { deg: 3, shapes: ['seventh', 'add9'], w: 1.4 },
    { deg: 4, shapes: ['sus4', 'seventh'], w: 0.6 },
  ],
  phrygian: [
    { deg: 0, shapes: ['fifths', 'sus2', 'triad', 'add9'], w: 3 },
    { deg: 1, shapes: ['add9', 'triad', 'seventh'], w: 2 },
    { deg: 5, shapes: ['add9', 'triad', 'seventh'], w: 1.6 },
    { deg: 6, shapes: ['triad', 'sus2'], w: 1.2 },
    { deg: 3, shapes: ['seventh', 'add9'], w: 1 },
  ],
};
// Pentatonic / exotic scales use "open" shapes made of scale steps.
const PENT_PALETTE = [
  { deg: 0, shapes: ['triad', 'fifths', 'open'], w: 3 },
  { deg: 1, shapes: ['triad', 'open'], w: 1.4 },
  { deg: 2, shapes: ['triad', 'fifths'], w: 1.6 },
  { deg: 3, shapes: ['triad', 'open'], w: 1.6 },
  { deg: 4, shapes: ['triad', 'fifths'], w: 1.2 },
];

/** Chooses the next chord: weighted palette, prefers common tones, avoids recent repeats. */
export class ChordWalker {
  constructor(rng, key, opts = {}) {
    this.r = rng; this.history = []; this.opts = opts;
    this.setKey(key);
  }
  setKey(key) {
    this.key = key;
    this.palette = this.opts.palette || PALETTES[key.mode] || PENT_PALETTE;
  }
  next(prevPcs = null) {
    const r = this.r, key = this.key, cands = [], ws = [];
    const last = this.history[this.history.length - 1];
    for (const p of this.palette) {
      for (const sh of p.shapes) {
        const id = p.deg + ':' + sh;
        let w = p.w / p.shapes.length;
        const ago = this.history.lastIndexOf(id);
        if (ago >= 0) { const dist = this.history.length - ago; w *= dist === 1 ? 0.02 : dist < 4 ? 0.25 : 0.7; }
        if (last && last.split(':')[0] === String(p.deg)) w *= 0.45; // move the root, mostly
        const pcs = key.chordPcs(p.deg, SHAPES[sh]);
        if (prevPcs) { let common = 0; for (const q of pcs) if (prevPcs.includes(q)) common++; w *= 0.6 + 0.35 * common; }
        if (this.opts.tonicPull && p.deg === 0) w *= this.opts.tonicPull;
        cands.push({ id, deg: p.deg, shape: sh, pcs }); ws.push(w);
      }
    }
    const c = r.weighted(cands, ws);
    this.history.push(c.id); if (this.history.length > 8) this.history.shift();
    c.bassPc = c.pcs[0];
    c.rootMidiPc = c.pcs[0];
    return c;
  }
}

/**
 * Minimal-motion voice-leading. prev: ascending midis (may be empty), pcs: target pitch classes.
 * Returns `n` ascending midis inside [lo, hi] covering the chord's colours with small motion,
 * avoiding semitone rubs in the low register and voice crossing.
 */
export function voiceLead(prev, pcs, { n = 4, lo = 50, hi = 79, rng = Math.random, maxLeap = 7 } = {}) {
  const pcset = [...new Set(pcs.map(pcOf))];
  if (!prev || prev.length !== n) return initialVoicing(pcset, n, lo, hi);
  const cands = prev.map((p) => {
    const list = [];
    for (let m = Math.max(lo, p - maxLeap); m <= Math.min(hi, p + maxLeap); m++) if (pcset.includes(pcOf(m))) list.push(m);
    list.sort((a, b) => Math.abs(a - p) - Math.abs(b - p));
    return list.slice(0, 4);
  });
  let best = null, bestCost = Infinity;
  const cur = [];
  const rec = (i, cost) => {
    if (cost >= bestCost) return;
    if (i === n) {
      const c2 = cost + shapePenalty(cur, pcset);
      if (c2 < bestCost) { bestCost = c2; best = cur.slice(); }
      return;
    }
    for (const m of cands[i]) {
      if (i > 0 && m <= cur[i - 1]) continue;
      cur.push(m);
      rec(i + 1, cost + Math.abs(m - prev[i]) * (0.85 + 0.3 * rng()));
      cur.pop();
    }
  };
  rec(0, 0);
  return best || initialVoicing(pcset, n, lo, hi);
}

function shapePenalty(v, pcset) {
  let pen = 0;
  const present = new Set(v.map(pcOf));
  const need = Math.min(v.length, pcset.length);
  let covered = 0; for (const p of pcset) if (present.has(p)) covered++;
  pen += (need - Math.min(need, covered)) * 3.2;
  pen += (v.length - present.size) * 0.8; // doublings
  for (let i = 1; i < v.length; i++) {
    const iv = v[i] - v[i - 1];
    if (iv === 1) pen += v[i] < 72 ? 5 : 1.5;
    else if (iv === 2 && v[i] < 57) pen += 1.5;
    if (iv > 12) pen += (iv - 12) * 0.7;
    if (v[i - 1] < 52 && iv < 5) pen += 2.5; // muddy low thirds
  }
  return pen;
}

function initialVoicing(pcset, n, lo, hi) {
  const out = [];
  let m = lo + 2;
  let k = 0;
  while (out.length < n && m <= hi + 12) {
    const want = pcset[k % pcset.length];
    while (pcOf(m) !== want) m++;
    out.push(m);
    m += 3; k++;
  }
  while (out.length < n) out.push(out[out.length - 1] + 7);
  return out.map((x) => (x > hi ? x - 12 : x)).sort((a, b) => a - b);
}

/** Bass note for a chord: pitch class pc placed nearest to `prev` inside [lo, hi]. */
export function placeBass(pc, prev, lo = 33, hi = 47) {
  let best = lo, bd = 1e9;
  for (let m = lo; m <= hi; m++) if (pcOf(m) === pc) { const d = prev ? Math.abs(m - prev) : Math.abs(m - (lo + hi) / 2); if (d < bd) { bd = d; best = m; } }
  return best;
}

// ---------------------------------------------------------------------------------------------
// THE WAY leitmotif: "rise – lean on the bright 4th – return – soar to the 9th – settle on 5".
// Degrees are scale steps from the tonic (0..), durations in beats.
// ---------------------------------------------------------------------------------------------
export const THEME = {
  a: { deg: [0, 4, 3, 4, 8, 6, 4], dur: [1, 1.5, 0.5, 2, 1.5, 0.5, 3] },
  b: { deg: [4, 5, 4, 2, 1, 0], dur: [1, 0.5, 0.5, 2, 1, 3] },
  head: { deg: [0, 4, 3, 4], dur: [1, 1.5, 0.5, 3] },
  tail: { deg: [8, 6, 4], dur: [1.5, 0.5, 3] },
};

export function themeNotes(key, tonicMidi, part = 'a', degShift = 0) {
  const T = THEME[part] || THEME.a;
  // map heptatonic theme degrees onto shorter scales proportionally
  const scale = key.n / 7;
  let t = 0;
  return T.deg.map((d, i) => {
    const deg = Math.round((d + degShift) * scale);
    const n = { midi: key.midi(deg, tonicMidi), t, dur: T.dur[i] };
    t += T.dur[i];
    return n;
  });
}

/**
 * Generative phrase over the current chord: a contour walk on the scale, landing on chord tones on
 * strong beats, ending long. Returns [{ midi, t, dur, vel }] with t/dur in beats.
 */
export function makePhrase(rng, key, chordPcs, { lo = 60, hi = 84, notes = [3, 7], start = null, cells = null } = {}) {
  const count = rng.int(notes[0], notes[1]);
  const pool = key.range(lo, hi);
  if (!pool.length) return [];
  const isChord = (m) => chordPcs.includes(pcOf(m));
  let idx;
  if (start != null) { idx = 0; let bd = 1e9; pool.forEach((m, i) => { const d = Math.abs(m - start); if (d < bd) { bd = d; idx = i; } }); }
  else { const ct = pool.map((m, i) => (isChord(m) ? i : -1)).filter((i) => i >= 0 && i > pool.length * 0.25 && i < pool.length * 0.8); idx = ct.length ? rng.pick(ct) : Math.floor(pool.length / 2); }
  const contour = rng.pick(['arch', 'fall', 'rise', 'wave']);
  const C = cells || [[1, 1, 2], [1.5, 0.5, 2], [0.5, 0.5, 1, 2], [2, 1, 1], [1, 0.5, 0.5, 2], [3, 1], [1, 1, 1, 1]];
  const durs = [];
  while (durs.length < count) durs.push(...rng.pick(C));
  durs.length = count;
  durs[count - 1] = Math.max(durs[count - 1], 2);
  const out = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const m = pool[idx];
    out.push({ midi: m, t, dur: durs[i], vel: 0.55 + 0.35 * rng() * (i === 0 ? 1.2 : 1) });
    t += durs[i];
    const ph = i / Math.max(1, count - 1);
    let dir = contour === 'rise' ? 1 : contour === 'fall' ? -1 : contour === 'arch' ? (ph < 0.5 ? 1 : -1) : Math.sin(ph * 6.28) > 0 ? 1 : -1;
    if (rng() < 0.2) dir = -dir;
    let step = rng() < 0.65 ? 1 : rng() < 0.7 ? 2 : 3;
    if (rng() < 0.08) step = 0;
    idx = Math.max(0, Math.min(pool.length - 1, idx + dir * step));
    // land on chord tones at phrase end / long notes
    if ((i === count - 2 || durs[i + 1] >= 2) && !isChord(pool[idx])) {
      if (idx + 1 < pool.length && isChord(pool[idx + 1])) idx++;
      else if (idx > 0 && isChord(pool[idx - 1])) idx--;
    }
  }
  return out;
}

export { pcOf };
