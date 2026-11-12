// Planet scene: orchestrates the planet modules on top of PlanetWorld.
//   terrain/  quadtree terrain + ocean (TerrainSystem)       sky/    atmosphere, sun, stars, env, clouds
//   life/     flora + fauna                                  civ/    cities, towns, monuments, traffic
//   player/   character, cameras, vehicles
// Render pipeline: world.scene → opaque HDR target (MSAA + float depth) → sky.composite → engine HDR target.
//
// URL params: id=<planet id, e.g. 0:0:3>  view=orbit|surface|fly  tod=<hours 0-24>  lat lon yaw pitch alt dist
//             timescale=<x>  (see player/index.js and module headers for more)
import * as THREE from 'three';
import { PlanetWorld } from './core/PlanetWorld.js';
import { TerrainSystem } from './terrain/TerrainSystem.js';
import { createSky } from './sky/index.js';
import { createLife } from './life/index.js';
import { createCiv } from './civ/index.js';
import { createPlayer } from './player/index.js';

export default class PlanetScene {
  constructor(ctx, params) {
    this.ctx = ctx;
    this.params = params;
    const id = params.id || '0:0:3';
    this.planet = ctx.universe.getPlanet(id);
    if (!this.planet) throw new Error(`No planet ${id}`);
    this.world = new PlanetWorld(ctx, this.planet, params);
    if (params.timescale) this.world.timeScale = parseFloat(params.timescale);
    this.breadcrumb = { label: this.planet.name };
    this.camera = this.world.camera;
    const samples = Math.min(4, ctx.renderer.capabilities.maxSamples || 0);
    const depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.opaque = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthTexture, depthBuffer: true });
    this.modules = [];
  }

  async init() {
    const w = this.world;
    this.terrain = new TerrainSystem(w);
    w.services.terrain = this.terrain;
    await this.terrain.init();
    this.sky = await createSky(w);
    w.services.sky = this.sky;
    this.player = await createPlayer(w);
    this.life = await createLife(w);
    this.civ = await createCiv(w);
    this.modules = [this.sky, this.life, this.civ];
    // prime: place camera, build the LOD for it before revealing
    w.update(0);
    this.player.update(0);
    this.sky.update(0);
    const cam = () => w.cameraPlanetPos(new THREE.Vector3());
    const settle = this.terrain.waitSettled(cam, this.ctx.shot ? 180000 : 9000);
    this.ready = Promise.all([settle, this.life.ready, this.civ.ready]).then(() => this.terrain.waitSettled(cam, this.ctx.shot ? 60000 : 3000));
    if (!this.ctx.shot) await Promise.race([settle, new Promise((r) => setTimeout(r, 6000))]);
  }

  enter() {
    const p = this.planet, ctx = this.ctx;
    ctx.engine.post.set({ exposure: 1.35, bloomStrength: 0.06, bloomRadius: 1.0, toneMap: 'agx', saturation: 1.08, contrast: 1.06, vignette: 0.28, grain: 0.025, chromatic: 0.15 });
    this.player.enter?.();
    ctx.audio.setMood(`planet:${p.themeData?.ambience || 'meadow'}`);
    ctx.hud.showCard(null);
    if (!ctx.shot) ctx.narrator?.say?.(`${p.name}. ${p.themeData?.title || ''}`, { quiet: true });
  }

  onBack() { return this.player.onBack?.() || false; }

  update(dt, time) {
    const w = this.world, inp = this.ctx.input;
    if (inp.pressed('timeFaster')) { w.timeScale = Math.min(512, w.timeScale * 2); this.ctx.hud.toast(`Time ×${w.timeScale}`); }
    if (inp.pressed('timeSlower')) { w.timeScale = Math.max(0.125, w.timeScale / 2); this.ctx.hud.toast(`Time ×${w.timeScale}`); }
    w.update(dt);
    this.player.update(dt);
    w.camera.updateMatrixWorld();
    this.terrain.update(dt, w.cameraPlanetPos(new THREE.Vector3()));
    for (const m of this.modules) m.update?.(dt, time);
    const night = 1 - THREE.MathUtils.smoothstep(w.sunElevation(w.focus.lengthSq() ? w.focus : w.cameraPlanetPos(new THREE.Vector3())), -0.12, 0.08);
    this.ctx.audio.setParam?.('night', night);
  }

  render(renderer, target) {
    const e = this.ctx.engine;
    if (this.opaque.width !== e.drawWidth || this.opaque.height !== e.drawHeight) this.opaque.setSize(e.drawWidth, e.drawHeight);
    renderer.setRenderTarget(this.opaque);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(this.world.scene, this.world.camera);
    this.sky.composite(renderer, this.opaque, target, this.world.camera);
    this.modules.forEach((m) => m.afterComposite?.(renderer, target, this.world.camera));
  }

  exit() { this.ctx.hud.setPrompt(null); this.ctx.input.releasePointer(); }

  dispose() {
    for (const m of [...this.modules, this.player]) m?.dispose?.();
    this.terrain?.dispose();
    this.opaque.dispose();
    this.world.dispose();
  }
}
