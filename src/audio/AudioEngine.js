// Generative audio engine (WebAudio). This is the shared contract; the score itself lives in
// moods (src/audio/moods/*) which build node graphs on demand. Nothing is sampled — all synthesized.
//
// API used by scenes:
//   audio.unlock()                      must be called from a user gesture
//   audio.setMood(name, { intensity })  crossfades to a soundscape: 'intro' | 'cosmos' | 'galaxy' |
//                                       'blackhole' | 'system' | 'planet:<ambience>' | 'silence'
//   audio.cue(name, opts)               one-shots: 'select' | 'hover' | 'warp' | 'transition' | 'land' |
//                                       'takeoff' | 'jump' | 'step' | 'boost' | 'chime'
//   audio.setParam(name, value)         continuous controls: 'speed' (0..1), 'altitude' (m), 'wind' (0..1),
//                                       'engine' (0..1), 'tension' (0..1), 'night' (0..1)
//   audio.toggleMute() -> muted

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.mood = null;
    this.moodName = 'silence';
    this.params = { speed: 0, altitude: 0, wind: 0, engine: 0, tension: 0, night: 0 };
    this._moodLoaders = new Map();
    this._pendingMood = null;
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 3.5; comp.attack.value = 0.01; comp.release.value = 0.4;
      this.master.connect(comp).connect(c.destination);
      this.bus = c.createGain();
      this.bus.connect(this.master);
      this.reverb = c.createConvolver();
      this.reverb.buffer = this._impulse(5.5, 2.6);
      this.reverbSend = c.createGain();
      this.reverbSend.gain.value = 0.55;
      this.reverbSend.connect(this.reverb).connect(this.master);
      this.sfx = c.createGain(); this.sfx.gain.value = 0.7; this.sfx.connect(this.master); this.sfx.connect(this.reverbSend);
    }
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch (_) {} }
    if (this._pendingMood) { const [n, o] = this._pendingMood; this._pendingMood = null; this.setMood(n, o); }
  }

  _impulse(seconds, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (t < 0.01 ? t / 0.01 : 1);
      }
    }
    return buf;
  }

  /** Register a mood factory: (audio, opts) => { stop(fadeSeconds), update?(dt, params), setIntensity? } */
  registerMood(name, factory) { this._moodLoaders.set(name, factory); }

  setMood(name, opts = {}) {
    if (!this.ctx) { this._pendingMood = [name, opts]; return; }
    if (name === this.moodName && !opts.force) { this.mood?.setIntensity?.(opts.intensity ?? 1); return; }
    const old = this.mood;
    if (old) old.stop?.(opts.fade ?? 3.0);
    this.mood = null;
    this.moodName = name;
    const base = name.split(':')[0];
    const factory = this._moodLoaders.get(name) || this._moodLoaders.get(base) || this._moodLoaders.get('default');
    if (factory) {
      try { this.mood = factory(this, { ...opts, variant: name.split(':')[1] }); } catch (e) { console.warn('[audio] mood failed', name, e); }
    }
  }

  setParam(name, value) { this.params[name] = value; }

  cue(name, opts = {}) {
    if (!this.ready) return;
    const f = this._cues?.[name];
    if (f) { try { f(this, opts); } catch (e) { console.warn('[audio] cue failed', name, e); } }
  }
  registerCues(map) { this._cues = { ...(this._cues || {}), ...map }; }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.15);
    return this.muted;
  }

  update(dt) { this.mood?.update?.(dt, this.params); }
}
