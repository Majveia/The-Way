// Baseline player/camera controller for planets (the player team replaces this with a full
// third/first-person character, vehicles and cinematic landing). Modes:
//   orbit — camera orbits the planet (drag/pinch); F descends to the surface
//   walk  — first-person on foot with gravity (WASD, Shift sprint, Space jump); V toggles fly
//   fly   — free flight, speed scales with altitude (Space/C up/down)
// Contract: createPlayer(world) → { update(dt), onBack() → bool, enter(), dispose(), position (planet frame), mode }
// URL params: view=orbit|surface|fly  lat lon (deg, override spawn)  yaw pitch (deg)  alt (m, fly)  dist (orbit radii)
import * as THREE from 'three';
import { damp } from '../../../engine/rng.js';

export async function createPlayer(world) { return new BaselinePlayer(world); }

const EYE = 1.7;

class BaselinePlayer {
  constructor(world) {
    this.world = world;
    this.ctx = world.ctx;
    this.input = world.ctx.input;
    const p = world.params;
    this.position = new THREE.Vector3();
    this.heading = new THREE.Vector3();
    this.pitch = ((parseFloat(p.pitch) || -4) * Math.PI) / 180;
    this.vVel = 0;
    this.speed = 0;
    this.onGround = true;
    this.mode = p.view === 'surface' ? 'walk' : p.view === 'fly' ? 'fly' : 'orbit';
    this.orbit = { yaw: 0.6, pitch: 0.25, dist: world.radius * (parseFloat(p.dist) || 2.7), gYaw: 0.6, gPitch: 0.25, gDist: world.radius * (parseFloat(p.dist) || 2.7) };
    this._spawn(p);
    world.services.player = this;
    this._tmp = new THREE.Vector3(); this._tmp2 = new THREE.Vector3();
  }

  _spawn(p) {
    const w = this.world;
    let dir;
    if (p.lat !== undefined && p.lon !== undefined) dir = w.latLonToDir(parseFloat(p.lat), parseFloat(p.lon));
    else dir = new THREE.Vector3(...w.sites.spawn.dir);
    const alt = p.view === 'fly' ? parseFloat(p.alt) || 320 : EYE;
    w.surfacePoint(dir, alt, this.position);
    if (w.services.terrain?.hasOcean) { const r = w.radius + Math.max(0, w.heightAt(dir.x, dir.y, dir.z)) + alt; this.position.copy(dir).multiplyScalar(r); }
    const up = dir.clone();
    let fwd;
    if (w.sites.spawn.facing && p.lat === undefined) fwd = new THREE.Vector3(...w.sites.spawn.facing).sub(dir);
    else fwd = new THREE.Vector3(0, 1, 0).cross(up).cross(up).negate();
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-8) fwd.set(1, 0, 0).addScaledVector(up, -up.x);
    fwd.normalize();
    if (p.yaw !== undefined) fwd.applyAxisAngle(up, (parseFloat(p.yaw) * Math.PI) / 180);
    this.heading.copy(fwd);
    // orbit framing: look at the spawn hemisphere
    this.orbit.yaw = this.orbit.gYaw = Math.atan2(dir.x, dir.z);
    this.orbit.pitch = this.orbit.gPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -0.9, 0.9)) * 0.8 + 0.12;
  }

  enter() { this._applyMode(); }

  _applyMode() {
    const hud = this.ctx.hud;
    if (this.mode === 'orbit') {
      this.input.setMode('orbit');
      hud.setPrompt('F', `Descend to ${this.world.planet.name}`, () => this.land());
      hud.setHint('Drag to orbit · scroll to zoom · F to descend');
    } else {
      this.input.setMode('avatar');
      hud.setPrompt(null);
      hud.setHint(this.mode === 'walk' ? 'WASD move · Shift sprint · Space jump · V fly · Esc orbit' : 'WASD fly · Space/C up/down · Shift boost · V walk · Esc orbit');
    }
  }

  land() { this.mode = 'walk'; this._spawn({ ...this.world.params, view: 'surface' }); this._applyMode(); this.ctx.audio.cue?.('land'); }

  onBack() {
    if (this.mode !== 'orbit') { this.mode = 'orbit'; this.input.releasePointer(); this._applyMode(); return true; }
    return false;
  }

  update(dt) {
    const w = this.world, inp = this.input;
    if (this.mode !== 'orbit' && inp.pressed('view')) { this.mode = this.mode === 'walk' ? 'fly' : 'walk'; this.vVel = 0; this._applyMode(); }
    if (this.mode === 'orbit' && inp.pressed('interact')) this.land();
    if (this.mode === 'orbit') this._orbit(dt);
    else this._avatar(dt);
  }

  _orbit(dt) {
    const o = this.orbit, inp = this.input, w = this.world;
    const look = inp.lookDelta();
    o.gYaw -= look.x * 0.004; o.gPitch = THREE.MathUtils.clamp(o.gPitch + look.y * 0.004, -1.4, 1.4);
    const z = inp.zoom();
    if (z) o.gDist = THREE.MathUtils.clamp(o.gDist * Math.pow(0.88, z), w.radius * 1.12, w.radius * 12);
    if (!look.x && !look.y) o.gYaw += dt * 0.012;
    o.yaw = damp(o.yaw, o.gYaw, 5, dt); o.pitch = damp(o.pitch, o.gPitch, 5, dt);
    o.dist = Math.exp(damp(Math.log(o.dist), Math.log(o.gDist), 4, dt));
    const cp = Math.cos(o.pitch);
    this.position.set(Math.sin(o.yaw) * cp, Math.sin(o.pitch), Math.cos(o.yaw) * cp).multiplyScalar(o.dist);
    w.setFocus(this._tmp.copy(this.position).setLength(w.radius));
    const cam = w.camera;
    cam.up.set(0, 1, 0);
    w.toWorld(this.position, cam.position);
    cam.lookAt(w.toWorld(this._tmp2.set(0, 0, 0), this._tmp2));
    cam.near = Math.max(10, (o.dist - w.radius) * 0.01); cam.updateProjectionMatrix();
  }

  _avatar(dt) {
    const w = this.world, inp = this.input;
    const up = this._tmp.copy(this.position).normalize();
    const look = inp.lookDelta();
    this.heading.applyAxisAngle(up, -look.x * 0.0024);
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.y * 0.0024, -1.45, 1.45);
    this.heading.addScaledVector(up, -this.heading.dot(up)).normalize();
    const right = this._tmp2.copy(this.heading).cross(up).normalize();
    const mv = inp.move();
    const sprint = inp.down('sprint');
    const dirLen = this.position.length();
    const ground = w.groundHeightAt(up.x, up.y, up.z);
    const alt = dirLen - w.radius - ground;
    if (this.mode === 'walk') {
      const target = (sprint ? 9.5 : 4.2) * Math.min(1, Math.hypot(mv.x, mv.y));
      this.speed = damp(this.speed, target, 8, dt);
      const v = new THREE.Vector3().addScaledVector(this.heading, mv.y).addScaledVector(right, mv.x);
      if (v.lengthSq() > 1e-6) v.setLength(this.speed);
      this.position.addScaledVector(v, dt);
      if (this.onGround && inp.pressed('jump')) { this.vVel = 5.2; this.onGround = false; this.ctx.audio.cue?.('jump'); }
      this.vVel -= w.planet.gravity * dt;
      let r = this.position.length() + this.vVel * dt;
      const u2 = this.position.normalize();
      const g2 = w.groundHeightAt(u2.x, u2.y, u2.z);
      const floor = w.radius + g2 + EYE;
      if (r <= floor) { r = floor; this.vVel = 0; this.onGround = true; }
      this.position.multiplyScalar(r);
    } else {
      const base = Math.max(18, alt * 0.6);
      const sp = base * (sprint ? 6 : 1);
      const fwd3 = this.heading.clone().applyAxisAngle(right, this.pitch);
      const v = new THREE.Vector3().addScaledVector(fwd3, mv.y).addScaledVector(right, mv.x);
      if (inp.down('up')) v.addScaledVector(up, 1);
      if (inp.down('down')) v.addScaledVector(up, -1);
      this.position.addScaledVector(v, sp * dt);
      const u2 = this._tmp.copy(this.position).normalize();
      const minR = w.radius + w.groundHeightAt(u2.x, u2.y, u2.z) + 2.0;
      if (this.position.length() < minR) this.position.setLength(minR);
    }
    w.setFocus(this.position);
    const cam = w.camera;
    const up2 = this._tmp.copy(this.position).normalize();
    cam.up.copy(up2);
    w.toWorld(this.position, cam.position);
    const right2 = this._tmp2.copy(this.heading).cross(up2).normalize();
    const lookDir = this.heading.clone().applyAxisAngle(right2, this.pitch);
    cam.lookAt(cam.position.clone().add(lookDir));
    const altNow = this.position.length() - w.radius - w.groundHeightAt(up2.x, up2.y, up2.z);
    const near = THREE.MathUtils.clamp(altNow * 0.02, 0.06, 50);
    if (Math.abs(cam.near - near) > near * 0.2) { cam.near = near; cam.updateProjectionMatrix(); }
    this.ctx.audio.setParam?.('altitude', altNow);
  }

  dispose() {}
}
