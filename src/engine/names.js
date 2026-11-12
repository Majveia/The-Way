// Procedural naming with distinct "tongues" so places feel like they belong to cultures.
import { Random } from './rng.js';

const TONGUES = {
  // soft, flowing — pastoral & sea worlds
  aelian: { on: ['a', 'e', 'i', 'o', 'ae', 'ia', 'ea', 'io'], c: ['l', 'r', 'n', 'm', 's', 'th', 'v', 'el', 'al', 'sh'], end: ['a', 'iel', 'ora', 'ene', 'is', 'eth', 'wyn', 'ae', 'ion', 'ara'] },
  // hard, monumental — desert, forge, ruins
  kharic: { on: ['a', 'u', 'o', 'ar', 'ur', 'au'], c: ['k', 'kh', 'r', 'z', 'd', 'g', 'm', 'th', 'q', 'sh'], end: ['an', 'ur', 'ek', 'oth', 'ar', 'um', 'az', 'ra', 'ad', 'uun'] },
  // bright, crystalline — crystal & metropolis
  lucent: { on: ['i', 'y', 'e', 'ai', 'ei'], c: ['l', 'v', 'x', 'n', 'ph', 's', 'z', 'lyr', 'qu', 't'], end: ['is', 'yx', 'ae', 'ion', 'el', 'ia', 'ys', 'ex', 'yn', 'ix'] },
  // hushed, cold — glacier, moons
  nordic: { on: ['e', 'o', 'u', 'ei', 'y'], c: ['sk', 'v', 'r', 'n', 'f', 'h', 'l', 'k', 'st', 'dr'], end: ['heim', 'vik', 'a', 'ur', 'en', 'ir', 'unn', 'grim', 'is', 'ald'] },
  // lyrical — jungles, blossoms
  sylvan: { on: ['a', 'o', 'i', 'u', 'ao', 'ui'], c: ['m', 'n', 'k', 'h', 'l', 'y', 'w', 'ts', 'r', 'p'], end: ['ani', 'oka', 'ume', 'aya', 'ito', 'ena', 'aru', 'imi', 'oro', 'aki'] },
};

const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function makeName(seed, tongue = 'aelian', syllables = 0) {
  const r = new Random(seed);
  const T = TONGUES[tongue] || TONGUES.aelian;
  const n = syllables || r.int(1, 3);
  let s = r.bool(0.55) ? r.pick(T.c) : '';
  for (let i = 0; i < n; i++) {
    s += r.pick(T.on);
    if (i < n - 1) s += r.pick(T.c);
  }
  s += r.pick(T.end);
  s = s.replace(/(.)\1\1+/g, '$1$1');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function tongueNames() { return Object.keys(TONGUES); }
export const greek = (i) => GREEK[i % GREEK.length];
export const roman = (i) => ROMAN[i % ROMAN.length] || String(i + 1);

/** Catalog-style designation for stars/galaxies: e.g. "TW-4471", "NGC-like" numbering. */
export function catalog(prefix, id) { return `${prefix}-${String(id).padStart(4, '0')}`; }
