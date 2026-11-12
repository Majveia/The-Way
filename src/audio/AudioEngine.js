// Generative audio engine (WebAudio). This is the shared contract; the score itself lives in
// src/audio/score.js + src/audio/moods/* which build node graphs on demand. Nothing is sampled —
// every sound is synthesized.
//
// API used by scenes:
//   audio.unlock()                      must be called from a user gesture
//   audio.setMood(name, { intensity, fade })
//                                       crossfades to a soundscape: 'intro' | 'cosmos' | 'galaxy' |
//                                       'blackhole' | 'system' | 'planet:<ambience>' | 'silence'
//   audio.cue(name, opts)               one-shots: 'select' | 'hover' | 'warp' | 'transition' | 'dive' |
//                                       'land' | 'takeoff' | 'jump' | 'step' {surface} | 'boost' | 'chime' |
//                                       'engine_on' | 'engine_off'
//   audio.setParam(name, value)         continuous controls: 'speed' (0..1), 'altitude' (m), 'wind' (0..1),
//                                       'engine' (0..1), 'tension' (0..1), 'night' (0..1)
//   audio.toggleMute() -> muted
//
// Mix graph (all gain-staged for ~-18 LUFS program loudness, peaks < -1 dBFS):
//   moods → bus ─────────────────────────────┐
//   cues  → sfx ───────────────┐             │
//   reverbSend → HP → hall IR ─┼→ widen ─────┤
//   spaceSend  → HP → long IR ─┘             ├→ master (volume/mute) → glue comp → limiter → out
//   delaySend  → stereo echo ────────────────┘
//
// Extensions (backward compatible): registerLayer(name, factory) for persistent layers any mood can
// host (e.g. the vehicle engine), mood.handoff(nextName) for seamless mood→mood continuations,
// attach(ctx) to drive an OfflineAudioContext in tests, and `music` (current key/chord) so cues
// harmonise with the score.

const isLiteDevice = () => {
  try {
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua)) return true;
    if (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) return true; // iPadOS
    return (navigator.hardwareConcurrency || 8) <= 2;
  } catch (_) { return false; }
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.9;
    this.mood = null;
    this.moodName = 'silence';
    this.params = { speed: 0, altitude: 0, wind: 0, engine: 0, tension: 0, night: 0 };
    this._moodLoaders = new Map();
    this._pendingMood = null;
    this._lastMoodOpts = {};
    this._cues = {};
    this._layerFactories = new Map();
    this.layers = new Map();
    this.lite = isLiteDevice();
    this._offline = false;
    this._lastUpdate = 0;
    this._watchdog = null;
    // Current harmony published by the playing mood (cues harmonise with it).
    this.music = { root: 2, mode: 'lydian', chord: [50, 57, 62, 64, 66, 69], bass: 38, tonic: 50 };
  }

  get ready() { return !!this.ctx && (this.ctx.state === 'running' || this._offline); }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC({ latencyHint: this.lite ? 'playback' : 'interactive' }); } catch (_) { this.ctx = new AC(); }
      this._build(this.ctx);
      this._installResumeHooks();
      this._watchdog = setInterval(() => this._watch(), 250);
    }
    if (this.ctx.state !== 'running' && !this.muted) { try { await this.ctx.resume(); } catch (_) {} }
    if (this._pendingMood) { const [n, o] = this._pendingMood; this._pendingMood = null; this.setMood(n, o); }
  }

  /** Test/tooling hook: drive an existing (e.g. Offline) AudioContext. */
  attach(ctx, { offline = true, lite } = {}) {
    this.ctx = ctx;
    this._offline = offline;
    if (lite !== undefined) this.lite = lite;
    this._build(ctx);
    if (this._pendingMood) { const [n, o] = this._pendingMood; this._pendingMood = null; this.setMood(n, o); }
    return this;
  }

  _build(c) {
    const lite = this.lite;
    // ---- output: master volume → glue compressor → safety limiter → destination
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const glue = c.createDynamicsCompressor();
    glue.threshold.value = -15; glue.knee.value = 10; glue.ratio.value = 2.2; glue.attack.value = 0.025; glue.release.value = 0.4;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -2.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.15;
    this.master.connect(glue).connect(limiter).connect(c.destination);
    this.glue = glue; this.limiter = limiter;

    // ---- music / ambience bus
    this.bus = c.createGain();
    this.bus.connect(this.master);

    // ---- stereo widener shared by the reverb returns (M/S: side × width)
    this.widen = makeWidener(c, 1.25);
    this.widen.output.connect(this.master);

    // ---- hall reverb (cues, ambiences, instruments)
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.6;
    const hpV = c.createBiquadFilter(); hpV.type = 'highpass'; hpV.frequency.value = 160; hpV.Q.value = 0.6;
    this.reverb = c.createConvolver();
    this.reverb._seconds = lite ? 3.2 : 4.2;
    this._irPending(this.reverb, { seconds: this.reverb._seconds, t60: lite ? 2.6 : 3.4, pre: 0.025, bright: 8000, dark: 900, damp: 1.1, early: 0.7, seed: 21 });
    this.verbReturn = c.createGain(); this.verbReturn.gain.value = 1;
    this.reverbSend.connect(hpV).connect(this.reverb).connect(this.verbReturn).connect(this.widen.input);

    // ---- long "space" reverb (cosmic moods). Lite devices share the hall to save CPU.
    if (lite) {
      this.spaceSend = c.createGain();
      this.spaceSend.gain.value = 0.9;
      this.spaceSend.connect(this.reverbSend);
      this.spaceVerb = this.reverb;
    } else {
      this.spaceSend = c.createGain();
      this.spaceSend.gain.value = 0.6;
      const hpS = c.createBiquadFilter(); hpS.type = 'highpass'; hpS.frequency.value = 110; hpS.Q.value = 0.6;
      this.spaceVerb = c.createConvolver();
      this._irPending(this.spaceVerb, { seconds: 9, t60: 7.5, pre: 0.045, bright: 6500, dark: 500, damp: 0.55, early: 0.25, seed: 77 });
      this.spaceReturn = c.createGain(); this.spaceReturn.gain.value = 1;
      this.spaceSend.connect(hpS).connect(this.spaceVerb).connect(this.spaceReturn).connect(this.widen.input);
    }

    // ---- stereo echo (ping-pong with darkening feedback)
    this.delaySend = c.createGain(); this.delaySend.gain.value = 1;
    const dl = c.createDelay(2), dr = c.createDelay(2);
    dl.delayTime.value = 0.43; dr.delayTime.value = 0.645;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.5;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220; hp.Q.value = 0.5;
    const fbA = c.createGain(), fbB = c.createGain(); fbA.gain.value = 0.42; fbB.gain.value = 0.42;
    const pl = c.createStereoPanner(), pr = c.createStereoPanner(); pl.pan.value = -0.7; pr.pan.value = 0.7;
    const echoOut = c.createGain(); echoOut.gain.value = 0.55;
    this.delaySend.connect(hp).connect(dl);
    dl.connect(lp).connect(fbA).connect(dr).connect(fbB).connect(dl);
    dl.connect(pl).connect(echoOut);
    dr.connect(pr).connect(echoOut);
    echoOut.connect(this.master);
    const echoVerb = c.createGain(); echoVerb.gain.value = 0.35; echoOut.connect(echoVerb).connect(this.reverbSend);
    this.delay = { left: dl, right: dr, feedback: [fbA, fbB], out: echoOut };

    // ---- cues
    this.sfx = c.createGain(); this.sfx.gain.value = 0.7;
    this.sfx.connect(this.master);
    this.sfxVerb = c.createGain(); this.sfxVerb.gain.value = 0.35;
    this.sfx.connect(this.sfxVerb).connect(this.reverbSend);

    // persistent layers registered before the context existed
    for (const name of this._layerFactories.keys()) this._makeLayer(name);
  }

  _irPending(conv, spec) {
    // Impulse generation is a few ms of JS; done synchronously so the graph is complete at once.
    import('./dsp.js').then(({ impulseBuffer }) => { try { conv.buffer = impulseBuffer(this.ctx, spec); } catch (e) { console.warn('[audio] ir', e); } });
  }

  _installResumeHooks() {
    if (typeof window === 'undefined') return;
    const resume = () => { if (this.ctx && this.ctx.state !== 'running' && !this.muted) this.ctx.resume().catch(() => {}); };
    for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, resume, { passive: true });
  }

  _watch() {
    // Keeps generative scheduling alive when requestAnimationFrame is throttled (hidden tab).
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    if (now - this._lastUpdate > 400) { this._tick(Math.min(1, (now - (this._lastTick || now - 250)) / 1000)); }
  }

  /** Register a mood factory: (audio, opts) => { stop(fadeSeconds), update?(dt, params), setIntensity?, handoff? } */
  registerMood(name, factory) {
    this._moodLoaders.set(name, factory);
    // A scene may have asked for a mood before the (lazily loaded) score registered it.
    if (this.ctx && !this.mood && this.moodName !== 'silence' && !this._retryQueued) {
      this._retryQueued = true;
      queueMicrotask(() => {
        this._retryQueued = false;
        if (this.ctx && !this.mood && this.moodName !== 'silence') this.setMood(this.moodName, { ...this._lastMoodOpts, force: true, fade: 2 });
      });
    }
  }

  _factoryFor(name) {
    const base = name.split(':')[0];
    return this._moodLoaders.get(name) || this._moodLoaders.get(base) || this._moodLoaders.get('default');
  }

  setMood(name, opts = {}) {
    if (!name) name = 'silence';
    if (!this.ctx) { this._pendingMood = [name, opts]; this.moodName = name; this._lastMoodOpts = opts; return; }
    if (name === this.moodName && this.mood && !opts.force) { this.mood?.setIntensity?.(opts.intensity ?? 1); return; }
    const old = this.mood;
    const prev = this.moodName;
    this.moodName = name;
    this._lastMoodOpts = opts;
    if (old && old.handoff && name !== prev) {
      let next = null;
      try { next = old.handoff(name, opts); } catch (e) { console.warn('[audio] handoff failed', e); }
      if (next) { this.mood = next; return; }
    }
    if (old) { try { old.stop?.(opts.fade ?? 3.0); } catch (e) { console.warn('[audio] stop failed', e); } }
    this.mood = null;
    const factory = this._factoryFor(name);
    if (factory) {
      try { this.mood = factory(this, { ...opts, variant: name.split(':')[1], from: prev }); } catch (e) { console.warn('[audio] mood failed', name, e); }
    }
  }

  setParam(name, value) { this.params[name] = value; }

  cue(name, opts = {}) {
    if (!this.ready || this.muted) return;
    const f = this._cues?.[name];
    if (f) { try { f(this, opts); } catch (e) { console.warn('[audio] cue failed', name, e); } }
  }
  registerCues(map) { this._cues = { ...(this._cues || {}), ...map }; }

  /** Persistent layer (e.g. vehicle engine) hosted regardless of the current mood. */
  registerLayer(name, factory) {
    this._layerFactories.set(name, factory);
    if (this.ctx) this._makeLayer(name);
  }
  _makeLayer(name) {
    const old = this.layers.get(name);
    if (old) { try { old.stop?.(0.5); } catch (_) {} }
    try { this.layers.set(name, this._layerFactories.get(name)(this)); } catch (e) { console.warn('[audio] layer failed', name, e); }
  }
  layer(name) { return this.layers.get(name); }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) {
      const c = this.ctx, t = c.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, t, 0.12);
      clearTimeout(this._muteTimer);
      if (this.muted && !this._offline) this._muteTimer = setTimeout(() => { if (this.muted && c.state === 'running') c.suspend().catch(() => {}); }, 900);
      else if (!this.muted && c.state !== 'running') c.resume().catch(() => {});
    }
    return this.muted;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.1);
  }

  update(dt) {
    if (!this.ctx) return;
    this._lastUpdate = typeof performance !== 'undefined' ? performance.now() : 0;
    this._tick(dt);
  }

  _tick(dt) {
    this._lastTick = typeof performance !== 'undefined' ? performance.now() : 0;
    const d = Math.min(Math.max(dt || 0, 0), 1);
    try { this.mood?.update?.(d, this.params); } catch (e) { console.warn('[audio] mood update', e); }
    for (const l of this.layers.values()) { try { l.update?.(d, this.params); } catch (e) { console.warn('[audio] layer update', e); } }
  }
}

/** Mid/side stereo widener: side × width (1 = unchanged). Forces stereo upmix on its input. */
export function makeWidener(c, width = 1.2) {
  const input = c.createGain();
  input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
  const split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
  const a = (1 + width) / 2, b = (1 - width) / 2;
  const LL = c.createGain(), LR = c.createGain(), RR = c.createGain(), RL = c.createGain();
  LL.gain.value = a; RR.gain.value = a; LR.gain.value = b; RL.gain.value = b;
  input.connect(split);
  split.connect(LL, 0); split.connect(LR, 0); split.connect(RR, 1); split.connect(RL, 1);
  LL.connect(merge, 0, 0); RL.connect(merge, 0, 0);
  RR.connect(merge, 0, 1); LR.connect(merge, 0, 1);
  return {
    input, output: merge,
    set(w, t = c.currentTime) { const A = (1 + w) / 2, B = (1 - w) / 2; for (const g of [LL, RR]) g.gain.setTargetAtTime(A, t, 0.2); for (const g of [LR, RL]) g.gain.setTargetAtTime(B, t, 0.2); },
  };
}
