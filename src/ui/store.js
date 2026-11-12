// Persisted user preferences. Every storage access is guarded: private mode, blocked storage and
// sandboxed iframes all throw, and the experience must work without persistence.
//
//   'theway.quality'   'auto' | 'low' | 'medium' | 'high'   (read by main.js before the Engine is built)
//   'theway.settings'  JSON of the remaining preferences below

const QUALITY_KEY = 'theway.quality';
const PREFS_KEY = 'theway.settings';

export const DEFAULTS = Object.freeze({
  quality: 'auto',
  sensitivity: 1, // look sensitivity multiplier (0.25 – 4)
  invertY: false,
  volume: 1, // 0 – 1
  muted: false,
  subtitles: true,
  fps: false,
  haptics: true,
});

export const QUALITIES = ['auto', 'low', 'medium', 'high'];

export function storageGet(key, area = 'local') {
  try { return (area === 'session' ? sessionStorage : localStorage).getItem(key); } catch (_) { return null; }
}
export function storageSet(key, value, area = 'local') {
  try { (area === 'session' ? sessionStorage : localStorage).setItem(key, value); } catch (_) { /* ignore */ }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function sanitize(k, v) {
  switch (k) {
    case 'quality': return QUALITIES.includes(v) ? v : DEFAULTS.quality;
    case 'sensitivity': return Number.isFinite(+v) ? clamp(+v, 0.25, 4) : DEFAULTS.sensitivity;
    case 'volume': return Number.isFinite(+v) ? clamp(+v, 0, 1) : DEFAULTS.volume;
    default: return typeof DEFAULTS[k] === 'boolean' ? !!v : v;
  }
}

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    let saved = null;
    try { saved = JSON.parse(storageGet(PREFS_KEY) || 'null'); } catch (_) { saved = null; }
    if (saved && typeof saved === 'object') for (const k of Object.keys(DEFAULTS)) if (k in saved && k !== 'quality') this.values[k] = sanitize(k, saved[k]);
    this.values.quality = sanitize('quality', storageGet(QUALITY_KEY) || 'auto');
    this._subs = new Set();
  }

  get(k) { return this.values[k]; }

  set(k, v) {
    if (!(k in DEFAULTS)) return;
    v = sanitize(k, v);
    if (this.values[k] === v) return;
    this.values[k] = v;
    if (k === 'quality') storageSet(QUALITY_KEY, v);
    else {
      const { quality, ...prefs } = this.values;
      storageSet(PREFS_KEY, JSON.stringify(prefs));
    }
    for (const fn of this._subs) { try { fn(this.values, k); } catch (e) { console.warn('[hud] settings listener', e); } }
  }

  onChange(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
}
