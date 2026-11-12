// PlanetWorld — shared state + API for every planet module (terrain, sky, life, civ, player).
//
// FRAMES
//   planet frame: origin at planet centre, y = rotation axis, meters. Gameplay state lives here (doubles in JS).
//   world frame : planet frame shifted by `origin` (floating origin) so everything near the camera has
//                 small coordinates → float32-safe on the GPU. `root` (THREE.Group) sits at -origin: add
//                 planet-frame objects under `root`, world-frame objects directly to `scene`.
//   world.toWorld(p) / world.toPlanet(p) convert. Modules holding world-frame state implement onOriginShift(delta).
//
// SERVICES (modules register themselves so others can query them)
//   services.terrain  heightAt(x,y,z) sampleAt(x,y,z) hasOcean
//   services.sky      sunDir, colors, cloud cover, fog/air queries
//   services.player   position (planet), mode, vehicle
//   services.civ      sites, nearest settlement, roads…
//   services.life     flora/fauna queries
import * as THREE from 'three';
import { getSystem } from '../../../engine/Universe.js';
import { computeSites } from './sites.js';
import { createTerrainFn } from '../terrain/terrainFn.js';
import { latLonToDir, dirToLatLon } from './cubesphere.js';

export class PlanetWorld {
  constructor(ctx, planet, params = {}) {
    this.ctx = ctx;
    this.params = params;
    this.planet = planet;
    this.radius = planet.radius;
    const [g, s] = planet.systemId.split(':').map(Number);
    this.system = getSystem(g, s);
    this.star = this.system.star;
    this.isGas = planet.kind === 'gas';

    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.root = new THREE.Group();
    this.root.name = 'planet-root';
    this.scene.add(this.root);
    this.origin = new THREE.Vector3();

    this.camera = new THREE.PerspectiveCamera(62, ctx.engine.aspect, 0.08, 4e8);
    this._offResize = ctx.engine.onResize(() => { this.camera.aspect = ctx.engine.aspect; this.camera.updateProjectionMatrix(); });

    // Sites are computed from the base terrain (no flattening) so the terrain can then flatten them.
    const baseFn = createTerrainFn(planet, []);
    this.sites = computeSites(planet, baseFn);

    // Time & sun
    this.time = 0;
    this.timeScale = 1;
    this.dayLength = planet.dayLength || 1200;
    const spawnLL = dirToLatLon(...this.sites.spawn.dir);
    this.refLon = spawnLL[1];
    this.hours = params.tod !== undefined ? parseFloat(params.tod) : 9.2; // local solar time at spawn longitude
    this.season = 0.25;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.starColor = new THREE.Color(this.star.color);
    this.sun = new THREE.DirectionalLight(0xffffff, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    const sc = this.sun.shadow.camera; sc.left = -180; sc.right = 180; sc.top = 180; sc.bottom = -180; sc.near = 1; sc.far = 6000;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x8fb4ff, 0x3a3226, 0.6);
    this.scene.add(this.hemi);

    this.services = {};
    this._listeners = new Map();
    this.focus = new THREE.Vector3(); // planet-frame point the camera/player cares about
    this._v = new THREE.Vector3();
  }

  // ---------- events ----------
  on(name, fn) { if (!this._listeners.has(name)) this._listeners.set(name, new Set()); this._listeners.get(name).add(fn); return () => this._listeners.get(name).delete(fn); }
  emit(name, data) { this._listeners.get(name)?.forEach((fn) => fn(data)); }

  // ---------- frames ----------
  toWorld(p, out = new THREE.Vector3()) { return out.copy(p).sub(this.origin); }
  toPlanet(p, out = new THREE.Vector3()) { return out.copy(p).add(this.origin); }
  cameraPlanetPos(out = new THREE.Vector3()) { return out.copy(this.camera.position).add(this.origin); }
  /** Planet-centre position in world frame. */
  get planetCenterWorld() { return this._v.copy(this.origin).negate(); }

  /** Re-anchor the floating origin near `planetPos` when it drifts too far. */
  setFocus(planetPos) {
    this.focus.copy(planetPos);
    const dx = planetPos.x - this.origin.x, dy = planetPos.y - this.origin.y, dz = planetPos.z - this.origin.z;
    if (dx * dx + dy * dy + dz * dz > 1200 * 1200) {
      const delta = new THREE.Vector3(Math.round(dx), Math.round(dy), Math.round(dz));
      this.origin.add(delta);
      this.root.position.copy(this.origin).negate();
      this.root.updateMatrixWorld(true);
      this.camera.position.sub(delta);
      this.emit('originShift', delta);
    }
  }

  // ---------- surface queries ----------
  /** Terrain height (m above sea level) at unit direction. */
  heightAt(x, y, z) { return this.services.terrain ? this.services.terrain.heightAt(x, y, z) : 0; }
  /** Ground height including the ocean surface (never below 0 when the planet has an ocean). */
  groundHeightAt(x, y, z) { const h = this.heightAt(x, y, z); return this.services.terrain?.hasOcean ? Math.max(h, 0) : h; }
  sampleAt(x, y, z, spacing) { return this.services.terrain?.sampleAt(x, y, z, spacing); }
  /** Planet-frame surface point for direction `dir` (THREE.Vector3 or array), plus `offset` meters. */
  surfacePoint(dir, offset = 0, out = new THREE.Vector3()) {
    const x = dir.x ?? dir[0], y = dir.y ?? dir[1], z = dir.z ?? dir[2];
    const l = Math.hypot(x, y, z);
    const h = this.heightAt(x / l, y / l, z / l);
    return out.set(x / l, y / l, z / l).multiplyScalar(this.radius + h + offset);
  }
  up(planetPos, out = new THREE.Vector3()) { return out.copy(planetPos).normalize(); }
  altitude(planetPos) { const l = planetPos.length(); return l - this.radius - this.heightAt(planetPos.x / l, planetPos.y / l, planetPos.z / l); }
  latLonToDir(lat, lon) { const d = latLonToDir(lat, lon); return new THREE.Vector3(d[0], d[1], d[2]); }

  // ---------- time & sun ----------
  update(dt) {
    this.time += dt;
    this.hours = (this.hours + (dt * 24 * this.timeScale) / this.dayLength) % 24;
    const dec = (this.planet.axialTilt || 0) * Math.sin(this.season * Math.PI * 2);
    const H = ((this.hours - 12) / 24) * Math.PI * 2;
    const lon = (this.refLon * Math.PI) / 180 - H;
    this.sunDir.set(Math.cos(dec) * Math.sin(lon), Math.sin(dec), Math.cos(dec) * Math.cos(lon)).normalize();
  }

  /** Sun elevation (sin) at a planet-frame position: >0 day, <0 night. */
  sunElevation(planetPos) { return this._v.copy(planetPos).normalize().dot(this.sunDir); }

  dispose() { this._offResize?.(); }
}
