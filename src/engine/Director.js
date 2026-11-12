// Scene director: lazy-loads scale scenes, runs cinematic transitions between them, keeps the
// breadcrumb trail (cosmos › galaxy › system › planet), and drives the per-frame update/render.
import * as THREE from 'three';
import { damp } from './rng.js';

/**
 * Scene contract (all methods optional except update):
 *   constructor(ctx, params)        ctx = { engine, renderer, input, director, audio, hud, params, shot, quality }
 *   async init()                    build GPU resources; may await workers etc.
 *   enter()                         called once visible; set post config, input mode, HUD, audio mood
 *   update(dt, time)                simulate + move camera
 *   render(renderer, target)        OPTIONAL custom render into HDR target; otherwise scene/camera are rendered
 *   scene, camera                   THREE.Scene / THREE.Camera for default rendering
 *   ready                           OPTIONAL Promise resolved when visually complete (shot mode waits for it)
 *   exit(), dispose()
 *   breadcrumb                      { label, sub } for the HUD trail
 */
export class Director {
  constructor(ctx) {
    this.ctx = ctx;
    this.registry = new Map();
    this.current = null; // { name, params, inst }
    this.loading = false;
    this.trail = []; // [{ name, params, label }]
    this._tr = null; // active transition
    this.listeners = new Set();
  }

  register(name, loader) { this.registry.set(name, loader); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /**
   * Navigate to a scene.
   * @param {string} name registry key
   * @param {object} params scene params (ids etc.)
   * @param {{transition?: 'fade'|'warp'|'dive'|'rise'|'none', duration?: number, push?: boolean, replaceTrail?: Array}} opts
   */
  async go(name, params = {}, opts = {}) {
    if (this.loading) return;
    const loader = this.registry.get(name);
    if (!loader) throw new Error(`Unknown scene ${name}`);
    this.loading = true;
    const kind = opts.transition ?? (this.current ? 'fade' : 'none');
    const dur = opts.duration ?? (kind === 'warp' ? 1.4 : kind === 'dive' || kind === 'rise' ? 1.1 : 0.8);
    const ctx = this.ctx;
    ctx.audio?.cue?.(kind === 'warp' ? 'warp' : 'transition');
    const loadPromise = loader().then(async (mod) => {
      const Cls = mod.default;
      const inst = new Cls(ctx, params);
      if (inst.init) await inst.init();
      return inst;
    });
    if (this.current && kind !== 'none') await this._animate(kind, 'out', dur * 0.55);
    let inst;
    try {
      inst = await loadPromise;
    } catch (err) {
      console.error('[director] failed to load scene', name, err);
      ctx.hud?.toast?.(`Could not open ${name}: ${err.message}`);
      this.loading = false;
      if (this.current) await this._animate('fade', 'in', 0.4);
      return;
    }
    const old = this.current;
    if (old) { try { old.inst.exit?.(); old.inst.dispose?.(); } catch (e) { console.warn(e); } }
    ctx.engine.post.reset();
    ctx.input.setMode('orbit');
    this.current = { name, params, inst };
    // breadcrumb trail
    if (opts.replaceTrail) this.trail = opts.replaceTrail;
    else {
      const depth = { intro: -1, cosmos: 0, galaxy: 1, blackhole: 2, system: 2, planet: 3 }[name] ?? 0;
      this.trail = this.trail.filter((t) => ({ intro: -1, cosmos: 0, galaxy: 1, blackhole: 2, system: 2, planet: 3 }[t.name] ?? 0) < depth);
      if (name !== 'intro') this.trail.push({ name, params, label: inst.breadcrumb?.label || name });
    }
    inst.enter?.();
    this.listeners.forEach((fn) => fn(this.current, this.trail));
    this.loading = false;
    if (kind !== 'none') await this._animate(kind, 'in', dur * 0.75);
    else { const p = ctx.engine.post.transition; p.fade = 0; p.zoomBlur = 0; p.flash = 0; }
  }

  /** Go up one level in the trail. */
  back() {
    if (this.trail.length < 2 || this.loading) return false;
    const prev = this.trail[this.trail.length - 2];
    this.go(prev.name, prev.params, { transition: 'rise' });
    return true;
  }

  _animate(kind, dir, duration) {
    const tr = this.ctx.engine.post.transition;
    return new Promise((resolve) => {
      this._tr = { kind, dir, t: 0, duration: Math.max(0.05, duration), resolve };
      if (this.ctx.shot) { this._applyTr(1); this._tr = null; resolve(); }
    });
  }

  _applyTr(k) {
    const tr = this.ctx.engine.post.transition;
    const { kind, dir } = this._tr || { kind: 'fade', dir: 'in' };
    const e = dir === 'out' ? k : 1 - k; // 0 = clear, 1 = fully covered
    const ease = e * e * (3 - 2 * e);
    tr.fade = kind === 'warp' ? Math.pow(ease, 3) : ease;
    tr.zoomBlur = kind === 'warp' ? ease * 1.0 : kind === 'dive' ? ease * 0.6 : kind === 'rise' ? ease * 0.35 : 0;
    tr.flash = kind === 'warp' ? Math.max(0, ease - 0.75) * 0.6 : 0;
    tr.fadeColor.setRGB(0, 0, 0);
  }

  update(dt, time) {
    if (this._tr) {
      this._tr.t += dt;
      const k = Math.min(1, this._tr.t / this._tr.duration);
      this._applyTr(k);
      if (k >= 1) { const r = this._tr.resolve; this._tr = null; r(); }
    }
    const cur = this.current?.inst;
    const engine = this.ctx.engine;
    if (cur) {
      cur.update?.(dt, time);
      if (cur.render) cur.render(engine.renderer, engine.post.sceneTarget);
      else if (cur.scene && cur.camera) engine.renderScene(cur.scene, cur.camera);
    } else {
      engine.renderer.setRenderTarget(engine.post.sceneTarget);
      engine.renderer.clear();
    }
    engine.present();
  }
}

/** Shared helper: smooth orbit camera for space scales (drag rotate, wheel/pinch zoom, focus tween). */
export class OrbitRig {
  constructor(camera, input, opts = {}) {
    this.camera = camera;
    this.input = input;
    this.target = new THREE.Vector3();
    this.goalTarget = new THREE.Vector3();
    this.yaw = opts.yaw ?? 0.6; this.pitch = opts.pitch ?? 0.35;
    this.goalYaw = this.yaw; this.goalPitch = this.pitch;
    this.distance = opts.distance ?? 10; this.goalDistance = this.distance;
    this.minDistance = opts.minDistance ?? 0.1; this.maxDistance = opts.maxDistance ?? 1e6;
    this.minPitch = opts.minPitch ?? -1.45; this.maxPitch = opts.maxPitch ?? 1.45;
    this.autoRotate = opts.autoRotate ?? 0.02; // rad/s drift when idle
    this.idle = 0;
    this.stiffness = opts.stiffness ?? 6;
    this.rotateSpeed = opts.rotateSpeed ?? 0.0042;
    this.zoomSpeed = opts.zoomSpeed ?? 0.18;
    this.enabled = true;
  }
  focus(pos, distance) { this.goalTarget.copy(pos); if (distance) this.goalDistance = distance; }
  update(dt) {
    const inp = this.input;
    if (this.enabled) {
      const look = inp.lookDelta();
      if (look.x || look.y) { this.goalYaw -= look.x * this.rotateSpeed; this.goalPitch += look.y * this.rotateSpeed; this.idle = 0; }
      const z = inp.zoom();
      if (z) { this.goalDistance *= Math.pow(1 - this.zoomSpeed, z); this.idle = 0; }
      const mv = inp.move();
      if (mv.x || mv.y) { this.goalYaw -= mv.x * dt * 1.2; this.goalDistance *= Math.pow(1 - 0.9 * dt, mv.y); this.idle = 0; }
    }
    this.idle += dt;
    if (this.idle > 4) this.goalYaw += this.autoRotate * dt * Math.min(1, (this.idle - 4) / 3);
    this.goalPitch = Math.min(this.maxPitch, Math.max(this.minPitch, this.goalPitch));
    this.goalDistance = Math.min(this.maxDistance, Math.max(this.minDistance, this.goalDistance));
    const k = this.stiffness;
    this.yaw = damp(this.yaw, this.goalYaw, k, dt);
    this.pitch = damp(this.pitch, this.goalPitch, k, dt);
    this.distance = Math.exp(damp(Math.log(this.distance), Math.log(this.goalDistance), k * 0.8, dt));
    this.target.x = damp(this.target.x, this.goalTarget.x, k * 0.6, dt);
    this.target.y = damp(this.target.y, this.goalTarget.y, k * 0.6, dt);
    this.target.z = damp(this.target.z, this.goalTarget.z, k * 0.6, dt);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + this.distance * cp * Math.sin(this.yaw),
      this.target.y + this.distance * Math.sin(this.pitch),
      this.target.z + this.distance * cp * Math.cos(this.yaw),
    );
    this.camera.lookAt(this.target);
  }
}
